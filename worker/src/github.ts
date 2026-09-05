// Everything the card needs, in three subrequests.
//
// The Python generator walks the REST API: repo list, then commit pages per
// repo. That is 40-70 subrequests, and a Worker on the free plan gets 50. So
// the same data is pulled with two batched GraphQL queries instead — repo list,
// contribution calendar and flake.nix in one, commit history for every active
// repo (aliased) in the next — plus one fetch for the avatar.

const API = "https://api.github.com/graphql";
const UA  = "muddyblack-card-worker";

/** Per-fetch deadlines.
 *
 *  GitHub's camo proxy gives an image source a handful of seconds and then
 *  gives up, and a browser <img> shows alt text when it does. An upstream
 *  fetch that merely hangs would therefore cost us the whole card, so every
 *  one of them is capped well inside that budget: better a stale card, or the
 *  placeholder, than a request nobody is still waiting on. */
export const GRAPHQL_TIMEOUT_MS = 6000;
export const AVATAR_TIMEOUT_MS  = 5000;
export const VIEWS_TIMEOUT_MS   = 3000;

export const DAYS_BACK = 365;
// A named zone, not a fixed offset — Germany is +1 in winter, +2 in summer.
// GitHub exposes no timezone through either API, so this is configuration.
export const DEFAULT_TZ = "Europe/Berlin";

/** Minutes east of UTC for `tz` at `at`, DST included. */
export function tzOffsetMinutes(tz: string, at: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(at);
  const f = Object.fromEntries(parts.map((p) => [p.type, p.value])) as Record<string, string>;
  const asUTC = Date.UTC(+f.year, +f.month - 1, +f.day, +f.hour, +f.minute, +f.second);
  return Math.round((asUTC - at.getTime()) / 60000);
}

/** The zone's current offset, spelled the way the card shows it. */
export function tzLabel(tz: string, at = new Date()): string {
  const total = tzOffsetMinutes(tz, at);
  const sign = total >= 0 ? "+" : "-";
  const hours = Math.floor(Math.abs(total) / 60);
  const minutes = Math.abs(total) % 60;
  return minutes ? `utc${sign}${hours}:${String(minutes).padStart(2, "0")}` : `utc${sign}${hours}`;
}
const MAX_HISTORY_ROUNDS = 6;  // 600 commits per repo; one subrequest each

export interface Repo {
  name: string;
  isFork: boolean;
  stars: number;
  pushedAt: string;
  /** Byte counts per language, largest first — GitHub's own linguist figures. */
  languages: { name: string; size: number }[];
}

export interface Profile {
  id: string;
  login: string;
  name: string | null;
  location: string | null;
  createdAt: string;
  avatarUrl: string;
  repos: Repo[];
  channel: string;
  days: Map<string, number>;
}

async function graphql<T>(token: string, query: string, variables: Record<string, unknown>): Promise<T> {
  const res = await fetch(API, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": UA,
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(GRAPHQL_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (body.errors) throw new Error(`GraphQL: ${JSON.stringify(body.errors).slice(0, 300)}`);
  if (!body.data) throw new Error("GraphQL returned no data");
  return body.data;
}

/** One year per window — the calendar API will not span more than that. */
function windows(from: Date, to: Date): [Date, Date][] {
  const out: [Date, Date][] = [];
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
  while (cursor < to) {
    const end = new Date(cursor);
    end.setUTCFullYear(end.getUTCFullYear() + 1);
    out.push([cursor, end > to ? to : end]);
    cursor = end;
  }
  return out;
}

const iso = (d: Date) => d.toISOString().replace(/\.\d+Z$/, "Z");

export async function profile(token: string, login: string, configRepo: string): Promise<Profile> {
  const [owner, repo] = configRepo.split("/");
  const now   = new Date();
  const born  = new Date("2020-01-01T00:00:00Z"); // widened below once known

  // The calendar windows depend on createdAt, which this same query returns —
  // so ask for a generous span and drop windows that predate the account.
  const spans = windows(born, now);
  const calendarFields = spans
    .map(([a, b], i) =>
      `w${i}: contributionsCollection(from:"${iso(a)}", to:"${iso(b)}") { ` +
      `contributionCalendar { weeks { contributionDays { date contributionCount } } } }`)
    .join("\n      ");

  const data = await graphql<any>(
    token,
    `query($login:String!, $owner:String!, $repo:String!) {
      user(login:$login) {
        id login name location createdAt avatarUrl(size: 200)
        repositories(first: 100, privacy: PUBLIC, ownerAffiliations: OWNER,
                     orderBy: {field: PUSHED_AT, direction: DESC}) {
          nodes {
            name isFork stargazerCount pushedAt
            languages(first: 20, orderBy: {field: SIZE, direction: DESC}) {
              edges { size node { name } }
            }
          }
        }
        ${calendarFields}
      }
      repository(owner:$owner, name:$repo) {
        object(expression: "HEAD:flake.nix") { ... on Blob { text } }
      }
    }`,
    { login, owner, repo },
  );

  const u = data.user;
  const days = new Map<string, number>();
  for (const key of Object.keys(u)) {
    if (!/^w\d+$/.test(key)) continue;
    for (const week of u[key].contributionCalendar.weeks) {
      for (const d of week.contributionDays) {
        days.set(d.date, Math.max(days.get(d.date) ?? 0, d.contributionCount));
      }
    }
  }

  const flake = data.repository?.object?.text ?? "";
  const match = flake.match(/nixpkgs\.url\s*=\s*"github:[^/]+\/nixpkgs\/([^"]+)"/);

  return {
    id: u.id,
    login: u.login,
    name: u.name,
    location: u.location,
    createdAt: u.createdAt,
    avatarUrl: u.avatarUrl,
    repos: u.repositories.nodes.map((r: any) => ({
      name: r.name, isFork: r.isFork, stars: r.stargazerCount, pushedAt: r.pushedAt,
      languages: (r.languages?.edges ?? []).map((e: any) => ({ name: e.node.name, size: e.size })),
    })),
    channel: match ? match[1].replace("nixos-", "") : "unstable",
    days,
  };
}

/** Commit hours (UTC+1) for every repo pushed inside the window.
 *
 *  A page is 100 commits, which several repos exceed — truncating there would
 *  quietly undercount, and worse, would undercount differently from the Python
 *  generator. So this follows cursors until every repo is exhausted, in rounds:
 *  one subrequest per round regardless of how many repos still have pages. */
export async function commitHours(token: string, p: Profile, tz: string): Promise<number[]> {
  const cutoff = new Date(Date.now() - DAYS_BACK * 86400_000);
  const active = p.repos.filter((r) => new Date(r.pushedAt) >= cutoff);
  if (!active.length) return [];

  const hours: number[] = [];
  let pending = active.map((r) => ({ name: r.name, after: null as string | null }));

  for (let round = 0; round < MAX_HISTORY_ROUNDS && pending.length; round++) {
    const fields = pending
      .map((r, i) =>
        `r${i}: repository(owner: $login, name: "${r.name}") { ` +
        `defaultBranchRef { target { ... on Commit { ` +
        `history(since: $since, author: {id: $uid}, first: 100` +
        `${r.after ? `, after: "${r.after}"` : ""}) { ` +
        `nodes { committedDate } pageInfo { hasNextPage endCursor } } ` +
        `} } } }`)
      .join("\n      ");

    const data = await graphql<any>(
      token,
      `query($login:String!, $uid:ID!, $since:GitTimestamp!) {\n      ${fields}\n    }`,
      { login: p.login, uid: p.id, since: iso(cutoff) },
    );

    const next: typeof pending = [];
    pending.forEach((repo, i) => {
      const history = data[`r${i}`]?.defaultBranchRef?.target?.history;
      if (!history) return;
      for (const n of history.nodes ?? []) {
        const at = new Date(n.committedDate);
        hours.push(new Date(at.getTime() + tzOffsetMinutes(tz, at) * 60000).getUTCHours());
      }
      if (history.pageInfo?.hasNextPage) {
        next.push({ name: repo.name, after: history.pageInfo.endCursor });
      }
    });
    pending = next;
  }

  return hours;
}

export interface LangWeights {
  ranked: [string, number][];
  commits: number;
  repos: number;
}

/** The treemap's data, in one subrequest.
 *
 *  A port of generate_lang_treemap.py's collect(): weigh each repo by the
 *  commits *you* pushed to it inside the window, then split that weight across
 *  the repo's language mix. The Python version needs two REST calls per repo;
 *  the byte counts already came down with the profile query, so all that is
 *  left is one aliased GraphQL call asking each active repo for a totalCount. */
export async function langWeights(token: string, p: Profile): Promise<LangWeights> {
  const cutoff = new Date(Date.now() - DAYS_BACK * 86400_000);
  const active = p.repos.filter(
    (r) => !r.isFork && r.languages.length && new Date(r.pushedAt) >= cutoff,
  );
  if (!active.length) return { ranked: [], commits: 0, repos: 0 };

  const fields = active
    .map((r, i) =>
      `r${i}: repository(owner: $login, name: "${r.name}") { ` +
      `defaultBranchRef { target { ... on Commit { ` +
      `history(since: $since, author: {id: $uid}) { totalCount } } } } }`)
    .join("\n      ");

  const data = await graphql<any>(
    token,
    `query($login:String!, $uid:ID!, $since:GitTimestamp!) {\n      ${fields}\n    }`,
    { login: p.login, uid: p.id, since: iso(cutoff) },
  );

  const weights = new Map<string, number>();
  let commits = 0, repos = 0;

  active.forEach((repo, i) => {
    const count = data[`r${i}`]?.defaultBranchRef?.target?.history?.totalCount ?? 0;
    if (!count) return;
    const bytes = repo.languages.reduce((sum, l) => sum + l.size, 0);
    if (!bytes) return;
    commits += count;
    repos += 1;
    for (const l of repo.languages) {
      weights.set(l.name, (weights.get(l.name) ?? 0) + (count * l.size) / bytes);
    }
  });

  const ranked = [...weights.entries()].sort((a, b) => b[1] - a[1]);
  return { ranked, commits, repos };
}

export interface Streaks {
  total: number;
  first: string;
  best: number;
  bestSpan: [string, string];
  current: number;
  currentEnd: string | null;
}

const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const shift  = (key: string, delta: number) =>
  dayKey(new Date(new Date(`${key}T00:00:00Z`).getTime() + delta * 86400_000));

export function streaks(days: Map<string, number>, tz: string): Streaks | null {
  const keys = [...days.keys()].sort();
  if (!keys.length) return null;

  const first = keys[0];
  const last  = keys[keys.length - 1];
  let total = 0;
  for (const v of days.values()) total += v;

  let best = 0, bestSpan: [string, string] = [first, first];
  let run = 0, runStart: string | null = null;
  for (let d = first; d <= last; d = shift(d, 1)) {
    if ((days.get(d) ?? 0) > 0) {
      runStart ??= d;
      run += 1;
      if (run > best) { best = run; bestSpan = [runStart, d]; }
    } else {
      run = 0; runStart = null;
    }
  }

  // today counts only if it has contributions, but an empty today does not
  // break a streak that ran through yesterday
  const now = new Date();
  const today = dayKey(new Date(now.getTime() + tzOffsetMinutes(tz, now) * 60000));
  let cursor = (days.get(today) ?? 0) > 0 ? today : shift(today, -1);
  let current = 0;
  const end = cursor;
  while ((days.get(cursor) ?? 0) > 0) { current += 1; cursor = shift(cursor, -1); }

  return { total, first, best, bestSpan, current, currentEnd: current ? end : null };
}

/** The avatar as a data: URI — the SVG has to stand alone behind camo. */
export async function avatar(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(AVATAR_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`avatar HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x2000) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x2000) as unknown as number[]);
  }
  const type = res.headers.get("content-type") ?? "image/png";
  return `data:${type};base64,${btoa(binary)}`;
}


/** The profile-view tally, read from the komarev pixel the README still loads.
 *
 *  Deliberately *read*, not counted here. A counter of our own would disagree
 *  with the Python fallback's number for the same card, and a view figure that
 *  changes depending on who rendered it is worse than one we do not own.
 *  Returns null if komarev is unreachable — the row is dropped, never guessed. */
export async function views(login: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://komarev.com/ghpvc/?username=${encodeURIComponent(login)}&style=flat-square`,
      { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(VIEWS_TIMEOUT_MS) },
    );
    if (!res.ok) return null;
    const found = [...(await res.text()).matchAll(/>([\d,]+)<\/text>/g)];
    if (!found.length) return null;
    return Number(found[found.length - 1][1].replace(/,/g, "")) || null;
  } catch {
    return null;
  }
}
