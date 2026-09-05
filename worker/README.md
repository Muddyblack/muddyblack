# muddyblack-card

Serves the README's cards as live SVGs, so it no longer needs a daily commit to
stay current.

| Route | Card | Python fallback |
|---|---|---|
| `/card.svg` (and `/`) | the fastfetch profile card | `scripts/generate_fastfetch.py` |
| `/languages.svg` | languages by commit weight | `scripts/generate_lang_treemap.py` |

## Setup, from nothing

You need a Cloudflare account and a GitHub token. Neither costs anything and
neither needs a card.

**1. Cloudflare account** — sign up at <https://dash.cloudflare.com/sign-up>.
Workers' free plan is enabled by default; you do not need a domain.

**2. A GitHub token.** GitHub's GraphQL API rejects anonymous requests, so one is
required even though everything read here is public. Give it as little power as
possible: <https://github.com/settings/tokens> → *Generate new token (classic)* →
tick **no scopes at all**. That should be enough for public profile, repo and
contribution data — if a query comes back empty, add `read:user` and nothing
more. Do not grant `repo`: the Worker asks for `privacy: PUBLIC` either way, so
private scope changes nothing except the damage if the token leaks.

**3. Install and log in.**

```sh
cd worker
npm install
npx wrangler login          # opens a browser to authorise
```

If `npm install` complains about the wrangler version, `npm i -D wrangler@latest`.

**4. Give it the token.** Stored encrypted by Cloudflare, never in the repo:

```sh
npx wrangler secret put GITHUB_TOKEN
```

**5. Try it locally first.**

```sh
cp .dev.vars.example .dev.vars    # then paste your token into it
npx wrangler dev                  # http://localhost:8787/card.svg
```

This is the only way to exercise `caches.default` and `ctx.waitUntil`; the
scripts under `test/` cover everything else without Cloudflare.

**6. Deploy.**

```sh
npx wrangler deploy
```

The first run asks you to pick a `workers.dev` subdomain, then prints the URL —
something like `https://muddyblack-card.<subdomain>.workers.dev`. Check it:

```sh
curl -sI https://muddyblack-card.<subdomain>.workers.dev/card.svg | head -3
```

**7. Point the README at it.** In the repo root `README.md`, replace both the
`href` and the `src`, for each card:

```html
<a href="https://muddyblack-card.<subdomain>.workers.dev/card.svg">
  <img src="https://muddyblack-card.<subdomain>.workers.dev/card.svg"
       alt="muddyblack@github" width="820" />
</a>
<a href="https://muddyblack-card.<subdomain>.workers.dev/languages.svg">
  <img src="https://muddyblack-card.<subdomain>.workers.dev/languages.svg"
       alt="languages by commit weight" width="820" />
</a>
```

Leave `scripts/` and the weekly workflow alone until you have watched the Worker
hold up for a few days — the committed `assets/fastfetch.svg` and
`assets/languages.svg` are the fallback, and reverting is a one-line edit while
they still exist.

`npx wrangler tail` streams live logs if something misbehaves.

## Why GraphQL and not REST

The Python generator walks the REST API — repo list, then commit pages per repo
— which is 40-70 subrequests. A Worker on the free plan gets **50 per request**,
so that approach would fail intermittently and only under load, which is the
worst way for it to fail. The Worker batches the same data into two GraphQL
queries (repos + calendar + `flake.nix` in one, commit history for every active
repo aliased into the next) plus one fetch for the avatar. Three subrequests.

The treemap is the same story, worse: `generate_lang_treemap.py` spends *two*
REST calls per repo (a commit count and a language breakdown). The Worker gets
the byte counts free — they ride along on the profile query — and asks for every
repo's commit `totalCount` in one aliased query. Two subrequests for
`/languages.svg`.

## Freshness

`Cache-Control: public, max-age=1800, stale-while-revalidate=86400`.

Worth being honest about what "live" means here: GitHub serves README images
through its camo proxy, which caches on its own schedule. The card updates
without a commit, but not instantly — expect it to lag by camo's TTL plus up to
30 minutes.

## Failure behaviour

**An image route never answers with something that is not an image.** This is
the whole rule, and it is worth stating plainly because the failure it prevents
looks like something else entirely: an `<img>` can only render an image, so a
500 with a text body, a timed-out fetch and a blank response all collapse to the
same thing in a README — the bare `alt` text. "It just shows text" is not a slow
connection; it is the Worker having answered with a non-image.

So, in order:

1. The last cached card, if the GitHub API errored and there is one.
2. Otherwise a placeholder SVG — the frame, the title, and a note that it is
   refreshing — served `200` with `max-age=60`, so camo drops it a minute later
   and tries again. It is built from constants alone: no fetch, nothing to fail.

Two supporting deadlines keep a *slow* upstream from becoming that same failure.
Camo gives an image source only a few seconds before it gives up, so each fetch
is capped (`GRAPHQL_TIMEOUT_MS` 6 s, avatar 5 s, komarev 3 s) and the whole
build is capped again at `BUILD_DEADLINE_MS` (9 s). Whichever fires, the request
still answers with an SVG rather than being cut off mid-transfer.

The avatar is treated as decoration, not data: if that one fetch fails the card
renders with an empty hex instead of taking everything else down with it.

Note what this does *not* depend on: the reader's connection. Cloudflare's CPU
time and the GitHub calls are identical whether the client is on fibre or
tethered — a slow client only makes the 88 KB transfer take longer, and a
partially transferred image still shows as alt text while it arrives. If the
card is *permanently* text for someone, look at the Worker, not their line.

## Testing before you deploy

```sh
worker/test/run.sh bench    # steady-state render CPU vs the free-plan budget
GITHUB_TOKEN=… worker/test/run.sh e2e   # real API call, writes /tmp/*.svg
tests/parity.sh             # both renderers vs the Python ones, byte for byte
```

`e2e` exercises the real queries, the streak maths and the renderer. It does not
exercise the Cloudflare-only parts (`caches.default`, `ctx.waitUntil`) — for
those, `npx wrangler dev` and hit http://localhost:8787/card.svg.

## The free plan

Measured, not guessed (`worker/test/run.sh bench` on the fixture):

| Limit | Budget | Actual |
|---|---|---|
| CPU per request | 10 ms | render p50 **0.59 ms**, p95 1.75 ms; avatar base64 0.17 ms |
| Subrequests per request | 50 | `/card.svg` **4–11** (1 profile + ≤6 history rounds + avatar + views); `/languages.svg` **2** |
| Requests | 100k/day | not close |

A word on that CPU figure: a *single* cold call measures V8 compiling the
renderer and reads ~30 ms, which looks like a failure. Workers reuses a warm
isolate across requests, so steady state is what the limit applies to. Benchmark
warm, or you will draw the wrong conclusion and go shopping for another host.

**The one real gotcha: `caches.default` does nothing on a `workers.dev`
subdomain.** Cache API operations there are silently no-ops, so every request
rebuilds the card — roughly 8 GitHub API calls each. That also means the stale
fallback above can never hit while the Worker lives on `workers.dev`: the
placeholder is doing all the work, and moving to a custom domain is what turns
"a placeholder for a minute" back into "yesterday's card". What still protects you is
the `Cache-Control` header, which GitHub's camo and browsers do honour, and camo
is what actually sits in front of this. If you want real edge caching, put the
Worker on a custom domain (a route on any zone you have in Cloudflare); the code
needs no change.

## Weight

The avatar is inlined as a data: URI, because an SVG behind camo cannot
reference anything external. It is fetched at 200px for a 150px slot: 400px made
it 222 KB of a 246 KB card, and dropping to 200 took the whole card to **88 KB**
with no visible loss.
