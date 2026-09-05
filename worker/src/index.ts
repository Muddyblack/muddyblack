// Serves the profile card live, so the README stops needing a daily commit.
//
// Caching matters more than it looks. GitHub proxies README images through
// camo, which caches on its own schedule, so "live" already means "as fresh as
// camo allows". On top of that this Worker holds its own copy for 30 minutes
// and serves a stale one for up to a day while it refreshes in the background —
// so a GitHub API hiccup shows yesterday's card rather than an error.

import {
  profile, commitHours, langWeights, streaks, avatar, views, tzLabel, DEFAULT_TZ,
} from "./github";
import { rows, render } from "./card";
import { fold, render as renderLangs } from "./languages";
import { placeholder } from "./fallback";

interface Env {
  GITHUB_TOKEN: string;
  GITHUB_USERNAME: string;
  NIXOS_REPO: string;
  CARD_TZ?: string;
}

const MAX_AGE = 1800;        // 30 min fresh
const SWR     = 86400;       // then a day of stale-while-revalidate

// How long a build gets before the request gives up on it. GitHub's camo proxy
// fetches a README image with a deadline of its own and shows nothing at all
// when that passes — so this has to expire *first*, while there is still time
// to answer with a real SVG. The individual fetches in github.ts are capped
// tighter still; this is the backstop for the whole chain of them.
const BUILD_DEADLINE_MS = 9000;

// A placeholder is a statement that something is wrong right now, not a card.
// It must expire quickly or camo will keep showing it long after the Worker has
// recovered — a minute is enough to absorb a burst without outliving the fault.
const FALLBACK_MAX_AGE = 60;

function svgResponse(body: string, cached: boolean, maxAge = MAX_AGE, swr = SWR): Response {
  const control = swr
    ? `public, max-age=${maxAge}, stale-while-revalidate=${swr}`
    : `public, max-age=${maxAge}`;
  return new Response(body, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": control,
      "X-Card-Cache": cached ? "HIT" : "MISS",
    },
  });
}

/** Reject once ms have passed, so a hung upstream cannot hold the request. */
function withDeadline<T>(work: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    work,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`build exceeded ${ms}ms`)), ms)),
  ]);
}

async function buildCard(env: Env): Promise<string> {
  const login = env.GITHUB_USERNAME;
  const tz = env.CARD_TZ || DEFAULT_TZ;
  const p = await profile(env.GITHUB_TOKEN, login, env.NIXOS_REPO);

  const [hours, pic, seen] = await Promise.all([
    commitHours(env.GITHUB_TOKEN, p, tz),
    // The avatar is decoration; the card is the data. A failed or slow fetch
    // used to reject the whole Promise.all and cost the reader everything, so
    // it degrades to an empty hex instead — see logo() in card.ts.
    avatar(p.avatarUrl).catch(() => ""),
    views(login),
  ]);

  const byHour = new Array(24).fill(0) as number[];
  for (const h of hours) byHour[h] += 1;

  return render(rows(p, hours.length, seen), byHour, streaks(p.days, tz), pic, login, tzLabel(tz));
}

async function buildLanguages(env: Env): Promise<string> {
  const p = await profile(env.GITHUB_TOKEN, env.GITHUB_USERNAME, env.NIXOS_REPO);
  const { ranked, commits, repos } = await langWeights(env.GITHUB_TOKEN, p);
  // Same rule as the generator: never publish an empty treemap. Throwing here
  // hands the request to the stale-cache fallback below.
  if (!ranked.length) throw new Error("no language data");
  const { tiles, tail } = fold(ranked);
  return renderLangs(tiles, tail, commits, repos);
}

/** Path → builder. Everything else is a 404. */
const ROUTES: Record<string, (env: Env) => Promise<string>> = {
  "/": buildCard,
  "/card.svg": buildCard,
  "/languages.svg": buildLanguages,
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "Cache-Control": "no-store" } });
    }
    const build = ROUTES[url.pathname];
    if (!build) {
      return new Response("not found", { status: 404 });
    }
    if (!env.GITHUB_TOKEN) {
      return new Response("GITHUB_TOKEN is not set (wrangler secret put GITHUB_TOKEN)", {
        status: 500,
      });
    }

    // "/" and "/card.svg" are the same image, so they share one cache entry.
    const cache = caches.default;
    const path = build === buildCard ? "/card.svg" : url.pathname;
    const key = new Request(new URL(path, url.origin).toString(), { method: "GET" });

    const hit = await cache.match(key);
    if (hit) {
      // refresh in the background once the fresh window has passed
      const age = Number(hit.headers.get("Age") ?? 0);
      if (age > MAX_AGE) {
        ctx.waitUntil(
          build(env)
            .then((svg) => cache.put(key, svgResponse(svg, false)))
            .catch(() => {}),
        );
      }
      return new Response(hit.body, {
        headers: { ...Object.fromEntries(hit.headers), "X-Card-Cache": "HIT" },
      });
    }

    try {
      const svg = await withDeadline(build(env), BUILD_DEADLINE_MS);
      const res = svgResponse(svg, false);
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (err) {
      // Never surface a broken image. An <img> can only render an image, so a
      // 500 with a text body is not a smaller failure than a blank one — it is
      // the same failure, and it is what puts bare alt text in the README.
      //
      // On a workers.dev subdomain there is a second trap: caches.default is a
      // documented no-op there, so this stale lookup always misses and the
      // placeholder is the only thing standing between a GitHub hiccup and that
      // alt text. Serve it, with 200 and a short TTL, and let the next request
      // try again.
      const stale = await cache.match(key, { ignoreMethod: true });
      if (stale) return stale;

      console.error(`${url.pathname} build failed: ${(err as Error).message}`);
      const langs = path === "/languages.svg";
      const title = langs ? "languages by commit weight" : "muddyblack@github";
      const svg = placeholder(title, "refreshing — check back in a minute", 820, langs ? 322 : 220);
      return svgResponse(svg, false, FALLBACK_MAX_AGE, 0);
    }
  },
} satisfies ExportedHandler<Env>;
