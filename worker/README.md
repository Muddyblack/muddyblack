# muddyblack-card

Serves the profile card as a live SVG, so the README no longer needs a daily
commit to stay current.

## Deploy

```sh
cd worker
npm install
npx wrangler login
npx wrangler secret put GITHUB_TOKEN     # classic token, `public_repo` is enough
npx wrangler deploy
```

Then point the README at it:

```html
<img src="https://muddyblack-card.<your-subdomain>.workers.dev/card.svg" width="820" />
```

## Why GraphQL and not REST

The Python generator walks the REST API — repo list, then commit pages per repo
— which is 40-70 subrequests. A Worker on the free plan gets **50 per request**,
so that approach would fail intermittently and only under load, which is the
worst way for it to fail. The Worker batches the same data into two GraphQL
queries (repos + calendar + `flake.nix` in one, commit history for every active
repo aliased into the next) plus one fetch for the avatar. Three subrequests.

## Freshness

`Cache-Control: public, max-age=1800, stale-while-revalidate=86400`.

Worth being honest about what "live" means here: GitHub serves README images
through its camo proxy, which caches on its own schedule. The card updates
without a commit, but not instantly — expect it to lag by camo's TTL plus up to
30 minutes.

## Failure behaviour

If the GitHub API errors, the Worker serves the last cached card rather than a
broken image. It only returns 500 when nothing has ever been cached.

## Limits

Free plan: 100k requests/day, 50 subrequests per request, 10ms CPU. Rendering is
string concatenation, so CPU is not close to the limit; the avatar is inlined as
a data: URI (~250KB), which is bandwidth rather than CPU.
