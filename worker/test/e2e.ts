// End-to-end run of the Worker's real data path against the live GitHub API,
// outside Cloudflare. Proves the queries, the streak maths and the renderer;
// does not prove Cloudflare-specific bits (caches.default, ctx.waitUntil).
import { writeFileSync } from "node:fs";
import {
  profile, commitHours, langWeights, streaks, avatar, views, tzLabel, DEFAULT_TZ,
} from "./github.ts";
import { rows, render } from "./card.ts";
import { fold, render as renderLangs } from "./languages.ts";

const token = process.env.GITHUB_TOKEN!;
const login = "Muddyblack";

const t = (label: string, ms: number) => console.error(`  ${label.padEnd(22)} ${ms.toFixed(0)} ms`);
let mark = Date.now();

const tz = process.env.CARD_TZ || DEFAULT_TZ;
const p = await profile(token, login, "Muddyblack/NixOS");
t("profile query", Date.now() - mark); mark = Date.now();

const [hours, pic, seen] = await Promise.all([
  commitHours(token, p, tz), avatar(p.avatarUrl), views(login),
]);
t("commits+avatar+views", Date.now() - mark); mark = Date.now();

const byHour = new Array(24).fill(0) as number[];
for (const h of hours) byHour[h] += 1;

const cpuStart = process.cpuUsage();
const svg = render(rows(p, hours.length, seen), byHour, streaks(p.days, tz), pic, login, tzLabel(tz));
const cpu = process.cpuUsage(cpuStart);
t("render (wall)", Date.now() - mark);
console.error(`  render CPU (cold)      ${((cpu.user + cpu.system) / 1000).toFixed(1)} ms`);
console.error("  ^ mostly V8 compiling the renderer. Workers reuses a warm isolate,\n"
  + "    so this is NOT the number the 10ms limit applies to — run `bench`.");

console.error(`\n  repos scanned          ${p.repos.length}`);
console.error(`  commits found          ${hours.length}`);
console.error(`  views                  ${seen}`);
console.error(`  timezone               ${tz} -> ${tzLabel(tz)}`);
console.error(`  avatar data URI        ${(pic.length / 1024).toFixed(0)} KB`);
console.error(`  svg out                ${(svg.length / 1024).toFixed(0)} KB`);
writeFileSync(process.argv[2], svg);

// the second card, on the same profile query the Worker reuses
mark = Date.now();
const { ranked, commits, repos } = await langWeights(token, p);
t("\nlanguage weights", Date.now() - mark);
const { tiles, tail } = fold(ranked);
console.error(`  languages              ${tiles.map(([l]) => l.toLowerCase()).join(" · ")}`);
console.error(`  weighted by            ${commits} commits across ${repos} repos`);
writeFileSync(process.argv[3], renderLangs(tiles, tail, commits, repos));
