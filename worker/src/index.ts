// Serves the profile card live, so the README stops needing a daily commit.
//
// Caching matters more than it looks. GitHub proxies README images through
// camo, which caches on its own schedule, so "live" already means "as fresh as
// camo allows". On top of that this Worker holds its own copy for 30 minutes
// and serves a stale one for up to a day while it refreshes in the background —
// so a GitHub API hiccup shows yesterday's card rather than an error.

import { profile, commitHours, streaks, avatar, views, tzLabel, DEFAULT_TZ } from "./github";
import { rows, render } from "./card";

interface Env {
  GITHUB_TOKEN: string;
  GITHUB_USERNAME: string;
  NIXOS_REPO: string;
  CARD_TZ?: string;
}

const MAX_AGE = 1800;        // 30 min fresh
const SWR     = 86400;       // then a day of stale-while-revalidate

function svgResponse(body: string, cached: boolean): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${MAX_AGE}, stale-while-revalidate=${SWR}`,
      "X-Card-Cache": cached ? "HIT" : "MISS",
    },
  });
}

async function build(env: Env): Promise<string> {
  const login = env.GITHUB_USERNAME;
  const tz = env.CARD_TZ || DEFAULT_TZ;
  const p = await profile(env.GITHUB_TOKEN, login, env.NIXOS_REPO);

  const [hours, pic, seen] = await Promise.all([
    commitHours(env.GITHUB_TOKEN, p, tz),
    avatar(p.avatarUrl),
    views(login),
  ]);

  const byHour = new Array(24).fill(0) as number[];
  for (const h of hours) byHour[h] += 1;

  return render(rows(p, hours.length, seen), byHour, streaks(p.days, tz), pic, login, tzLabel(tz));
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "Cache-Control": "no-store" } });
    }
    if (url.pathname !== "/" && url.pathname !== "/card.svg") {
      return new Response("not found", { status: 404 });
    }
    if (!env.GITHUB_TOKEN) {
      return new Response("GITHUB_TOKEN is not set (wrangler secret put GITHUB_TOKEN)", {
        status: 500,
      });
    }

    const cache = caches.default;
    const key = new Request(new URL("/card.svg", url.origin).toString(), { method: "GET" });

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
      const svg = await build(env);
      const res = svgResponse(svg, false);
      ctx.waitUntil(cache.put(key, res.clone()));
      return res;
    } catch (err) {
      // Never surface a broken image: fall back to whatever is still cached,
      // and only 500 if there is genuinely nothing to show.
      const stale = await cache.match(key, { ignoreMethod: true });
      if (stale) return stale;
      return new Response(`card build failed: ${(err as Error).message}`, {
        status: 500,
        headers: { "Cache-Control": "no-store" },
      });
    }
  },
} satisfies ExportedHandler<Env>;
