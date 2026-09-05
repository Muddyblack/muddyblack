// A port of scripts/generate_fastfetch.py's _svg. The geometry is deliberately
// identical, constant for constant, so the two renderers can be diffed.
//
// Every animation keeps a correct *static* state: rests hold the final value and
// animations run from t=0 with a leading hold, so a renderer that ignores SMIL
// still draws the true card.

import * as m from "./marina";
import type { Profile, Streaks } from "./github";
import { DAYS_BACK } from "./github";

const W = 820, LEFT = 40, RIGHT = W - 40;
const LOGO_SIZE = 150, TEXT_X = 224, VAL_X = 320;
const ROW_STEP = 26, GAP_STEP = 18;
const HEAD_Y = 62, BODY_Y = HEAD_Y + 26;
const DIAL_R = 46, DIAL_HUB = 13, BAND_H = 158;

// Hand-maintained rows — the parts of the rice no API knows about.
const STATIC = {
  Kernel: "linux-cachyos · lto",
  Shell: "zsh · powerlevel10k",
  "DE / WM": "kde plasma · hyprland",
  Terminal: "ghostty",
  Editor: "nvim · vscode · claude",
  Locale: "🇩🇪 · 🇫🇷 · 🇬🇧",
};

const FLAME =
  "M0,-10 C4.2,-5.6 7.3,-2.2 7.3,2 A7.3,7.3 0 0 1 -7.3,2 " +
  "C-7.3,-1.3 -4.2,-3.1 -2.2,-5.8 C-1.6,-3.3 -0.4,-2 0.7,-3.1 " +
  "C1.1,-5.8 0.4,-8.2 0,-10 Z";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

// The intro that used to be a readme-typing-svg request. It belongs in the card:
// a terminal is exactly where a line gets typed.
const TYPING = [
  "hey, i'm Christian",
  "hobby dev & network enthusiast",
  "i build the tools i wish existed (when i have time)",
  "nixos-rice · kde widgets · web · network labs",
];
const TYPE_ADV = 8.4;    // JetBrains Mono advance at 14px
const TYPE_IN = 1.1;     // seconds spent typing a line
const TYPE_OUT = 0.5;    // seconds spent deleting it
const TYPE_SLOT = 4.6;   // seconds per line, all in

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n1 = (v: number) => v.toFixed(1);
const n4 = (v: number) => v.toFixed(4);
/** Python's %g for the durations here: trims a trailing ".0". */
const g = (v: number) => String(v);
const n3 = (v: number) => +v.toFixed(3);
/** Python prints a float as "1.0", JS as "1" — keep the Python spelling. */
const pyf = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));
const rad = (deg: number) => (deg * Math.PI) / 180;

/** Python's round() breaks ties to even; Math.round() breaks them upward. The
 *  two renderers must agree byte for byte, so this mirrors Python. */
function roundHalfEven(v: number): number {
  const floor = Math.floor(v);
  const diff = v - floor;
  if (Math.abs(diff - 0.5) > Number.EPSILON) return Math.round(v);
  return floor % 2 === 0 ? floor : floor + 1;
}

function mix(a: string, b: string, t: number): string {
  let out = "#";
  for (let i = 0; i < 3; i++) {
    const av = parseInt(a.slice(1 + 2 * i, 3 + 2 * i), 16);
    const bv = parseInt(b.slice(1 + 2 * i, 3 + 2 * i), 16);
    out += roundHalfEven(av * (1 - t) + bv * t).toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** 0 at 01:00 (deepest night), 1 at 13:00 (peak day). */
const daylight = (h: number) => (Math.cos(((h - 13) / 24) * 2 * Math.PI) + 1) / 2;
const hourColour = (h: number) => mix(m.RAMP[1], m.TEAL, daylight(h));

const parseDay = (key: string) => new Date(`${key}T00:00:00Z`);
const short = (key: string) => {
  const d = parseDay(key);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
};

function uptime(created: string): string {
  const start = new Date(created), now = new Date();
  let years = now.getUTCFullYear() - start.getUTCFullYear();
  const before =
    now.getUTCMonth() < start.getUTCMonth() ||
    (now.getUTCMonth() === start.getUTCMonth() && now.getUTCDate() < start.getUTCDate());
  if (before) years -= 1;
  const anniv = new Date(start);
  anniv.setUTCFullYear(start.getUTCFullYear() + years);
  const days = Math.floor((now.getTime() - anniv.getTime()) / 86400_000);
  const parts: string[] = [];
  if (years) parts.push(`${years} year${years === 1 ? "" : "s"}`);
  parts.push(`${days} day${days === 1 ? "" : "s"}`);
  return parts.join(", ");
}

type Row = [string, string];

export function rows(p: Profile, totalCommits: number, views: number | null): Row[] {
  const own = p.repos.filter((r) => !r.isFork);
  const widgets = own.filter((r) => r.name.startsWith("kde-"));
  const stars = own.reduce((a, r) => a + r.stars, 0);

  let host = p.name || p.login;
  if (p.location) host = `${host} · ${p.location.toLowerCase()}`;

  const gap: Row = ["", ""];
  const out: Row[] = [
    ["OS", host],
    ["Distro", `NixOS ${p.channel} · x86_64`],
    ["Kernel", STATIC.Kernel],
    ["Shell", STATIC.Shell],
    ["DE / WM", STATIC["DE / WM"]],
    ["Terminal", STATIC.Terminal],
    ["Editor", STATIC.Editor],
    gap,
    ["Host", `github.com/${p.login}`],
    ["Uptime", uptime(p.createdAt)],
    ["Packages", `${own.length} repos · ${widgets.length} kde widgets`],
  ];
  if (stars) out.push(["Stars", `${stars}`]);
  if (views !== null) out.push(["Views", views.toLocaleString("en-US")]);
  out.push(["Locale", STATIC.Locale], gap,
    // Deliberately narrow, and labelled as such — see the Python generator.
    ["Commits", `${totalCommits.toLocaleString("en-US")} · in public repos · ${DAYS_BACK}d`]);
  return out;
}

function logo(x: number, y: number, size: number, pic: string): string[] {
  const cx = x + size / 2, cy = y + size / 2, r = size / 2, w = 2 * r;
  const hex = Array.from({ length: 6 }, (_, i) => {
    const a = rad(60 * i - 90);
    return `${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`;
  }).join(" ");
  return [
    '  <g aria-hidden="true">',
    `    <clipPath id="hexClip"><polygon points="${hex}"/></clipPath>`,
    // An empty pic means the avatar fetch failed. The hex outline alone is a
    // far better card than no card, so draw the frame and skip the fill —
    // never let one missing image take the whole render down with it.
    ...(pic
      ? [`    <image href="${pic}" x="${n1(cx - w / 2)}" y="${n1(cy - w / 2)}"` +
         ` width="${n1(w)}" height="${n1(w)}" clip-path="url(#hexClip)"` +
         ' preserveAspectRatio="xMidYMid slice"/>']
      : [`    <polygon points="${hex}" fill="${m.TRACK}"/>`]),
    `    <polygon points="${hex}" fill="none" stroke="${m.CYAN}" stroke-width="3"` +
      ' stroke-linejoin="round"/>',
    "  </g>",
  ];
}

function dial(cx: number, cy: number, byHour: number[]): string[] {
  const peak = Math.max(...byHour) || 1;
  const rim = DIAL_R + 7;
  const out = ["", "  <!-- commits by hour of day -->"];

  // the rim doubles as the day/night read: dim over the night hours, lit over
  // the daylight ones. Two arcs, no fill, so there is no hard half-disc edge.
  for (const [lo, hi, colour] of [[18, 30, m.RAMP[0]], [6, 18, m.CYAN]] as [number, number, string][]) {
    const a0 = rad(-90 + lo * 15), a1 = rad(-90 + hi * 15);
    out.push(
      `  <path d="M${n1(cx + rim * Math.cos(a0))},${n1(cy + rim * Math.sin(a0))}` +
      ` A${rim},${rim} 0 0 1 ${n1(cx + rim * Math.cos(a1))},${n1(cy + rim * Math.sin(a1))}"` +
      ` fill="none" stroke="${colour}" stroke-width="1.5" opacity="0.5" stroke-linecap="round"/>`,
    );
  }

  byHour.forEach((count, hour) => {
    const angle = rad(-90 + hour * 15);
    // every hour keeps a short stub, so a quiet hour reads as "quiet" rather
    // than as a gap in the dial
    const end = DIAL_HUB + 3 + (count / peak) * (DIAL_R - DIAL_HUB - 3);
    const x1 = cx + DIAL_HUB * Math.cos(angle), y1 = cy + DIAL_HUB * Math.sin(angle);
    const x2 = cx + end * Math.cos(angle), y2 = cy + end * Math.sin(angle);
    const delay = n3(0.2 + hour * 0.02), dur = n3(delay + 0.5);
    const kt = pyf(n3(delay / dur));
    const anim = (attr: string, from: number, to: number) =>
      `<animate attributeName="${attr}" values="${n1(from)};${n1(from)};${n1(to)}"` +
      ` keyTimes="0;${kt};1" dur="${pyf(dur)}s" begin="0s" fill="freeze"` +
      ' calcMode="spline" keySplines="0 0 1 1;0.3 0 0.2 1"/>';
    out.push(
      `  <line x1="${n1(x1)}" y1="${n1(y1)}" x2="${n1(x2)}" y2="${n1(y2)}"` +
      ` stroke="${hourColour(hour)}" stroke-width="3.2" stroke-linecap="round">` +
      anim("x2", x1, x2) + anim("y2", y1, y2) + "</line>",
    );
  });

  const fx = pyf(cx);
  out.push(
    `  <g transform="rotate(0 ${fx} ${cy})">`,
    `    <animateTransform attributeName="transform" type="rotate"` +
      ` values="0 ${fx} ${cy};360 ${fx} ${cy}" dur="16s" repeatCount="indefinite"/>`,
    `    <line x1="${fx}" y1="${cy}" x2="${fx}" y2="${n1(cy - rim)}"` +
      ` stroke="${m.TEAL}" stroke-width="1" opacity="0.3"/>`,
    "  </g>",
    `  <circle cx="${fx}" cy="${cy}" r="2.5" fill="${m.TEAL}" opacity="0.7"/>`,
  );

  for (const [hour, label] of [[0, "00"], [6, "06"], [12, "12"], [18, "18"]] as [number, string][]) {
    const a = rad(-90 + hour * 15);
    const tx = cx + (rim + 11) * Math.cos(a), ty = cy + (rim + 11) * Math.sin(a);
    out.push(`  <text x="${n1(tx)}" y="${n1(ty + 3)}" class="tick" text-anchor="middle">${label}</text>`);
  }
  return out;
}

/** The clock and the streak figures on one line.
 *
 *  They were stacked, which cost ~110px of height to say two things that are
 *  both "activity". Four cells: the dial keeps its own, the three figures split
 *  what is left. */
function band(y: number, byHour: number[], s: Streaks | null, tz: string): string[] {
  const dialW = 170;
  const rest = (RIGHT - (LEFT + dialW)) / 3;
  const cols = [0, 1, 2].map((i) => LEFT + dialW + rest * (i + 0.5));

  const out = ["", "  <!-- when I commit, and how long the streaks run -->"];
  out.push(...dial(LEFT + dialW / 2, y + 68, byHour));
  out.push(
    `  <text x="${pyf(LEFT + dialW / 2)}" y="${y + 148}" class="cap"` +
      ` text-anchor="middle">commits by hour · ${tz}</text>`,
  );
  if (!s) return out;

  const ring = 24;
  const circ = 2 * Math.PI * ring;
  const lead = circ * 0.75 - 15;
  const cy = y + 54;

  const figure = (cx: number, value: string, label: string, sub: string) => [
    `  <text x="${n1(cx)}" y="${y + 60}" class="fig" text-anchor="middle">${value}</text>`,
    `  <text x="${n1(cx)}" y="${y + 92}" class="figl" text-anchor="middle">${label}</text>`,
    `  <text x="${n1(cx)}" y="${y + 108}" class="figs" text-anchor="middle">${sub}</text>`,
  ];

  const born = parseDay(s.first);
  out.push(...figure(cols[0], s.total.toLocaleString("en-US"), "Total Contributions",
    `${MONTHS[born.getUTCMonth()]} ${born.getUTCDate()}, ${born.getUTCFullYear()} — Present`));

  out.push(
    `  <circle cx="${n1(cols[1])}" cy="${cy}" r="${ring}" fill="none" stroke="${m.TRACK}" stroke-width="3.5"/>`,
    `  <circle cx="${n1(cols[1])}" cy="${cy}" r="${ring}" fill="none" stroke="${m.CYAN}"` +
      ` stroke-width="3.5" stroke-linecap="round"` +
      ` stroke-dasharray="${n1(lead)} 30 ${n1(circ - lead - 30)} 0"/>`,
    `  <text x="${n1(cols[1])}" y="${cy + 8}" class="ring" text-anchor="middle">${s.current}</text>`,
    `  <g transform="translate(${n1(cols[1])},${cy - ring})">`,
    `    <path d="${FLAME}" fill="${m.TEAL}"/>`,
    `    <path d="${FLAME}" fill="${m.CYAN}" transform="scale(0.5)"/>`,
    "  </g>",
    `  <text x="${n1(cols[1])}" y="${y + 92}" class="figl" text-anchor="middle"` +
      ` style="fill:${m.CYAN}">Current Streak</text>`,
  );
  if (s.currentEnd) {
    out.push(`  <text x="${n1(cols[1])}" y="${y + 108}" class="figs" text-anchor="middle">${short(s.currentEnd)}</text>`);
  }
  out.push(...figure(cols[2], String(s.best), "Longest Streak",
    `${short(s.bestSpan[0])} — ${short(s.bestSpan[1])}`));

  for (let i = 0; i < 3; i++) {
    const x = LEFT + dialW + rest * i;
    out.push(`  <rect x="${n1(x)}" y="${y + 24}" width="1" height="${BAND_H - 72}" fill="${m.RULE}" opacity="0.7"/>`);
  }
  return out;
}

function prompt(y: number): string[] {
  const out = ["", "  <!-- the prompt you'd be looking at after the fetch -->"];
  for (const [text, colour, alpha, dx] of m.PROMPT) {
    const op = alpha ? ` opacity="${alpha}"` : "";
    const body = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace("❯", "&#10095;");
    out.push(`  <text x="${LEFT + dx}" y="${y}" class="pr" fill="${colour}"${op}>${body}</text>`);
  }
  const ruleX = LEFT + m.PROMPT_END;
  out.push(
    `  <rect x="${ruleX}" y="${y - 5}" width="${RIGHT - 14 - ruleX}" height="1.2" rx="0.6" fill="url(#promptFade)"/>`,
  );
  return out;
}

/** The intro, typed at a prompt on its own line.
 *
 *  Base state is the first line, fully typed, with the cursor parked at its
 *  end — so a renderer that ignores SMIL shows a finished line rather than an
 *  empty one. */
function typing(y: number): string[] {
  const n = TYPING.length;
  const total = n * TYPE_SLOT;
  const x0 = LEFT + 20;

  const out = ["", "  <!-- the intro, typed -->",
    `  <text x="${LEFT}" y="${y}" class="ty" fill="${m.TEAL}">&#10095;</text>`];

  const times: number[] = [];
  const xs: number[] = [];

  TYPING.forEach((phrase, i) => {
    const w = phrase.length * TYPE_ADV;
    const start = (i * TYPE_SLOT) / total;
    const typed = (i * TYPE_SLOT + TYPE_IN) / total;
    const deleting = ((i + 1) * TYPE_SLOT - TYPE_OUT) / total;
    const end = ((i + 1) * TYPE_SLOT) / total;

    const kt = `0;${n4(start)};${n4(typed)};${n4(deleting)};${n4(end)};1`;
    out.push(
      `  <clipPath id="type${i}">` +
        `<rect x="${x0}" y="${y - 12}" width="${n1(i === 0 ? w : 0)}" height="16">`,
      `    <animate attributeName="width" values="0;0;${n1(w)};${n1(w)};0;0"` +
        ` keyTimes="${kt}" dur="${g(total)}s" repeatCount="indefinite" calcMode="linear"/>`,
      "  </rect></clipPath>",
      `  <g clip-path="url(#type${i})" opacity="${i === 0 ? 1 : 0}">`,
      `    <animate attributeName="opacity" values="0;1;1;0;0"` +
        ` keyTimes="0;${n4(start)};${n4(deleting)};${n4(end)};1" dur="${g(total)}s"` +
        ' repeatCount="indefinite" calcMode="discrete"/>',
      `    <text x="${x0}" y="${y}" class="ty" textLength="${n1(w)}"` +
        ` lengthAdjust="spacingAndGlyphs">${esc(phrase)}</text>`,
      "  </g>",
    );

    times.push(start, typed, deleting, end);
    xs.push(x0, x0 + w, x0 + w, x0);
  });

  const firstW = TYPING[0].length * TYPE_ADV;
  out.push(
    `  <rect x="${n1(x0 + firstW)}" y="${y - 11}" width="8" height="13" rx="1" fill="${m.TEAL}">`,
    `    <animate attributeName="x" values="${xs.map(n1).join(";")}"` +
      ` keyTimes="${times.map(n4).join(";")}" dur="${g(total)}s"` +
      ' repeatCount="indefinite" calcMode="linear"/>',
    '    <animate attributeName="opacity" values="1;1;0;0" dur="1.1s" repeatCount="indefinite"/>',
    "  </rect>",
  );
  return out;
}

export function render(
  rowList: Row[], byHour: number[], streak: Streaks | null, pic: string, login: string,
  tz: string,
): string {
  const ys: (number | null)[] = [];
  const seps: number[] = [];
  let y = BODY_Y;
  for (const [key] of rowList) {
    if (!key) { seps.push(y + GAP_STEP / 2); y += GAP_STEP; ys.push(null); continue; }
    y += ROW_STEP;
    ys.push(y);
  }
  const rowsEnd = y;

  const bodyEnd = Math.max(rowsEnd, BODY_Y + LOGO_SIZE);
  const bandY = bodyEnd + 30;
  const stripY = bandY + BAND_H + 16;
  const promptY = stripY + 8 + 30;
  const typingY = promptY + 26;
  const h = typingY + 26;

  const aria = rowList.filter(([k]) => k).map(([k, v]) => `${k}: ${v}`).join("; ");

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}"`,
    `     role="img" aria-label="${esc(aria)}">`,
    "  <defs>",
    '    <linearGradient id="headRule" x1="0" y1="0" x2="1" y2="0">',
    `      <stop offset="0%"   stop-color="${m.CYAN}" stop-opacity="0.95"/>`,
    `      <stop offset="55%"  stop-color="${m.TEAL}" stop-opacity="0.55"/>`,
    `      <stop offset="100%" stop-color="${m.TEAL}" stop-opacity="0"/>`,
    "    </linearGradient>",
    '    <linearGradient id="promptFade" x1="0" y1="0" x2="1" y2="0">',
    `      <stop offset="0%"   stop-color="${m.CYAN}" stop-opacity="0.55"/>`,
    `      <stop offset="85%"  stop-color="${m.CYAN}" stop-opacity="0.18"/>`,
    `      <stop offset="100%" stop-color="${m.CYAN}" stop-opacity="0"/>`,
    "    </linearGradient>",
    '    <linearGradient id="sepRule" x1="0" y1="0" x2="1" y2="0">',
    `      <stop offset="0%"   stop-color="${m.CYAN}" stop-opacity="0"/>`,
    `      <stop offset="50%"  stop-color="${m.CYAN}" stop-opacity="0.26"/>`,
    `      <stop offset="100%" stop-color="${m.CYAN}" stop-opacity="0"/>`,
    "    </linearGradient>",
    '    <linearGradient id="sweep" x1="0" y1="0" x2="1" y2="0">',
    '      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0"/>',
    '      <stop offset="50%"  stop-color="#FFFFFF" stop-opacity="0.9"/>',
    '      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>',
    "    </linearGradient>",
    "    <style>",
    `      .k    { font: 600 16px ${m.FONT}; fill: ${m.HEADING}; }`,
    `      .v    { font: 400 16px ${m.FONT}; fill: ${m.INK}; }`,
    `      .u    { font: 700 18px ${m.FONT}; fill: ${m.TEAL}; }`,
    `      .d    { font: 700 18px ${m.FONT}; fill: ${m.INK_MUTED}; }`,
    `      .tick { font: 500 10px ${m.FONT}; fill: ${m.INK_MUTED}; }`,
    `      .cap  { font: 500 11px ${m.FONT}; fill: ${m.INK_MUTED}; }`,
    `      .pr   { font: 500 12px ${m.FONT}; }`,
    `      .ty   { font: 500 14px ${m.FONT}; fill: ${m.INK}; }`,
    `      .fig  { font: 700 24px ${m.FONT}; fill: ${m.CYAN}; }`,
    `      .figl { font: 600 12px ${m.FONT}; fill: ${m.INK}; }`,
    `      .figs { font: 500 11px ${m.FONT}; fill: ${m.INK_MUTED}; }`,
    `      .ring { font: 700 20px ${m.FONT}; fill: ${m.INK}; }`,
    "    </style>",
    `    <clipPath id="headClip"><rect x="${TEXT_X}" y="${HEAD_Y + 12}" width="${RIGHT - TEXT_X}" height="2"/></clipPath>`,
    "  </defs>",
    "",
    `  <rect width="${W}" height="${h}" fill="${m.SURFACE}" rx="10" stroke="${m.RULE}" stroke-width="1"/>`,
  ];

  // top-aligned with the title rather than centred: fastfetch starts its art at
  // the first line, and centring left a dead band above the logo
  out.push(...logo(LEFT, HEAD_Y - 14, LOGO_SIZE, pic));

  out.push(
    "",
    `  <text x="${TEXT_X}" y="${HEAD_Y}"><tspan class="u">${esc(login.toLowerCase())}</tspan>` +
      '<tspan class="d">@</tspan><tspan class="u">github</tspan></text>',
    `  <rect x="${TEXT_X}" y="${HEAD_Y + 12}" width="${RIGHT - TEXT_X}" height="2" rx="1" fill="url(#headRule)"/>`,
    '  <g clip-path="url(#headClip)">',
    `    <rect x="${TEXT_X}" y="${HEAD_Y + 12}" width="110" height="2" rx="1" fill="url(#sweep)">`,
    `      <animate attributeName="x" from="${TEXT_X - 110}" to="${RIGHT}" dur="3.6s" repeatCount="indefinite"/>`,
    "    </rect>",
    "  </g>",
    `  <circle cx="${pyf((TEXT_X + RIGHT) / 2)}" cy="${HEAD_Y + 13}" r="2.5" fill="${m.TEAL}">`,
    '    <animate attributeName="opacity" values="0.3;1;0.3" dur="2.2s" repeatCount="indefinite"/>',
    "  </circle>",
  );

  rowList.forEach(([key, val], i) => {
    if (!key) return;
    const delay = n3(0.035 * i), dur = n3(delay + 0.4);
    out.push(
      "",
      '  <g opacity="1">',
      `    <animate attributeName="opacity" values="0;0;1" keyTimes="0;${pyf(n3(delay / dur))};1"` +
        ` dur="${pyf(dur)}s" begin="0s" fill="freeze"/>`,
      `    <text x="${TEXT_X}" y="${ys[i]}" class="k">${esc(key)}</text>`,
      `    <text x="${VAL_X}" y="${ys[i]}" class="v">${esc(val)}</text>`,
      "  </g>",
    );
  });

  out.push("");
  for (const sy of seps) {
    out.push(`  <rect x="${TEXT_X}" y="${n1(sy)}" width="${RIGHT - TEXT_X}" height="1" fill="url(#sepRule)"/>`);
  }

  out.push(`\n  <rect x="${LEFT}" y="${n1(bandY - 16)}" width="${RIGHT - LEFT}" height="1" fill="url(#sepRule)"/>`);
  out.push(...band(bandY, byHour, streak, tz));

  const seg = (RIGHT - LEFT - 6 * (m.ACCENTS.length - 1)) / m.ACCENTS.length;
  out.push("");
  m.ACCENTS.forEach((colour, i) => {
    out.push(`  <rect x="${n1(LEFT + i * (seg + 6))}" y="${n1(stripY)}" width="${n1(seg)}" height="8" rx="4" fill="${colour}"/>`);
  });

  out.push(...prompt(promptY));
  out.push(...typing(typingY));
  out.push("</svg>");
  return out.join("\n") + "\n";
}
