// Everything the card needs, in three subrequests.
//
// The Python generator walks the REST API: repo list, then commit pages per
// repo. That is 40-70 subrequests, and a Worker on the free plan gets 50. So
// the same data is pulled with two batched GraphQL queries instead — repo list,
// contribution calendar and flake.nix in one, commit history for every active
// repo (aliased) in the next — plus one fetch for the avatar.

const API = "https://api.github.com/graphql";
const UA  = "muddyblack-card-worker";

export const DAYS_BACK = 365;
const TZ_OFFSET_MS = 3600_000; // UTC+1, fixed — matches the Python
const MAX_HISTORY_ROUNDS = 6;  // 600 commits per repo; one subrequest each

export interface Repo {
  name: string;
  isFork: boolean;
  stars: number;
  pushedAt: string;
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
        id login name location createdAt avatarUrl(size: 400)
        repositories(first: 100, privacy: PUBLIC, ownerAffiliations: OWNER,
                     orderBy: {field: PUSHED_AT, direction: DESC}) {
          nodes { name isFork stargazerCount pushedAt }
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
export async function commitHours(token: string, p: Profile): Promise<number[]> {
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
        hours.push(new Date(new Date(n.committedDate).getTime() + TZ_OFFSET_MS).getUTCHours());
      }
      if (history.pageInfo?.hasNextPage) {
        next.push({ name: repo.name, after: history.pageInfo.endCursor });
      }
    });
    pending = next;
  }

  return hours;
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

export function streaks(days: Map<string, number>): Streaks | null {
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
  const today = dayKey(new Date(Date.now() + TZ_OFFSET_MS));
  let cursor = (days.get(today) ?? 0) > 0 ? today : shift(today, -1);
  let current = 0;
  const end = cursor;
  while ((days.get(cursor) ?? 0) > 0) { current += 1; cursor = shift(cursor, -1); }

  return { total, first, best, bestSpan, current, currentEnd: current ? end : null };
}

/** The avatar as a data: URI — the SVG has to stand alone behind camo. */
export async function avatar(url: string): Promise<string> {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`avatar HTTP ${res.status}`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
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
      { headers: { "User-Agent": UA } },
    );
    if (!res.ok) return null;
    const found = [...(await res.text()).matchAll(/>([\d,]+)<\/text>/g)];
    if (!found.length) return null;
    return Number(found[found.length - 1][1].replace(/,/g, "")) || null;
  } catch {
    return null;
  }
}
