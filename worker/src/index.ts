// Serves the profile card live, so the README stops needing a daily commit.
//
// A build takes GitHub's GraphQL API several seconds per call and the card
// needs a handful of them — far longer than camo, GitHub's README image proxy,
// will wait. So no reader ever waits on a build: a cron trigger rebuilds both
// SVGs every 15 minutes and stores them in KV, and a request only reads KV.
// A failed rebuild leaves the previous SVG in place, so a GitHub hiccup shows
// the last good card rather than an error.

import {
  profile, commitHours, langWeights, streaks, avatar, views, tzLabel, DEFAULT_TZ,
} from "./github";
import { rows, render } from "./card";
import { fold, render as renderLangs } from "./languages";
import { placeholder } from "./fallback";

interface Env {
  CARDS: KVNamespace;
  GITHUB_TOKEN: string;
  GITHUB_USERNAME: string;
  NIXOS_REPO: string;
  CARD_TZ?: string;
}

// How long camo and browsers may keep a card. The cron refreshes every 15
// minutes, so a short TTL here is what keeps the README close to that.
const MAX_AGE = 600;

// A placeholder only goes out before the first cron run has filled KV. It must
// expire quickly or camo will keep showing it after the real card exists.
const FALLBACK_MAX_AGE = 60;

function svgResponse(body: string, maxAge: number): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": `public, max-age=${maxAge}`,
    },
  });
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
  // keeps the previous one in KV.
  if (!ranked.length) throw new Error("no language data");
  const { tiles, tail } = fold(ranked);
  return renderLangs(tiles, tail, commits, repos);
}

/** KV key → builder, and the placeholder shown until that key exists. */
const CARDS: Record<string, { build: (env: Env) => Promise<string>; title: string; height: number }> = {
  "card.svg":      { build: buildCard,      title: "muddyblack@github",          height: 220 },
  "languages.svg": { build: buildLanguages, title: "languages by commit weight", height: 322 },
};

/** Path → KV key. Everything else is a 404. */
const ROUTES: Record<string, string> = {
  "/": "card.svg",
  "/card.svg": "card.svg",
  "/languages.svg": "languages.svg",
};

async function refresh(env: Env, key: string): Promise<void> {
  if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN is not set (wrangler secret put GITHUB_TOKEN)");
  await env.CARDS.put(key, await CARDS[key].build(env));
}

/** Rebuild every card; one failing leaves the others (and its old copy) alone. */
async function refreshAll(env: Env): Promise<void> {
  const keys = Object.keys(CARDS);
  const results = await Promise.allSettled(keys.map((key) => refresh(env, key)));
  results.forEach((r, i) => {
    if (r.status === "rejected") console.error(`${keys[i]} refresh failed: ${(r.reason as Error).message}`);
  });
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response("ok", { headers: { "Cache-Control": "no-store" } });
    }
    const key = ROUTES[url.pathname];
    if (!key) {
      return new Response("not found", { status: 404 });
    }

    const svg = await env.CARDS.get(key);
    if (svg) return svgResponse(svg, MAX_AGE);

    // Nothing stored yet — only right after the first deploy. Build in the
    // background so the next request has it, and answer with a real SVG now:
    // an <img> that gets anything else shows bare alt text in the README.
    ctx.waitUntil(refresh(env, key).catch((err) =>
      console.error(`${key} refresh failed: ${(err as Error).message}`)));
    const { title, height } = CARDS[key];
    return svgResponse(placeholder(title, "refreshing — check back in a minute", 820, height), FALLBACK_MAX_AGE);
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refreshAll(env));
  },
} satisfies ExportedHandler<Env>;
