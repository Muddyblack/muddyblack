// A port of scripts/generate_lang_treemap.py's render. As with card.ts the
// geometry is deliberately identical, constant for constant, so the committed
// fallback asset and the live one can be diffed byte for byte.

import * as m from "./marina";
import { DAYS_BACK } from "./github";

const W = 820, H = 322;
const PAD = 24;
const TOP = 52;
const BOTTOM = 34;
const GAP = 3;          // surface showing between tiles

const MAX_TILES = 7;    // languages shown individually; the tail folds into "other"
const MIN_SHARE = 0.015;

const RAMP = m.RAMP;
const OTHER = m.RULE;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n1 = (v: number) => v.toFixed(1);

/** Python's round() breaks ties to even; Math.round() breaks them upward. */
function roundHalfEven(v: number): number {
  const floor = Math.floor(v);
  const diff = v - floor;
  if (Math.abs(diff - 0.5) > Number.EPSILON) return Math.round(v);
  return floor % 2 === 0 ? floor : floor + 1;
}

/** Python's "%.0f". */
const n0 = (v: number) => String(roundHalfEven(v));
/** Python's "{:,}". */
const thousands = (v: number) => String(v).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
/** Python prints a float as "1.0", JS as "1" — keep the Python spelling. */
const pyf = (v: number) => (Number.isInteger(v) ? `${v}.0` : String(v));

export type Tile = [string, number];

/** Everything below MIN_SHARE, and everything past MAX_TILES, becomes "other". */
export function fold(ranked: Tile[]): { tiles: Tile[]; tail: string[] } {
  const total = ranked.reduce((sum, [, v]) => sum + v, 0);
  const tiles: Tile[] = [];
  const tail: string[] = [];
  for (const [lang, value] of ranked) {
    if (tiles.length < MAX_TILES && value / total >= MIN_SHARE) tiles.push([lang, value]);
    else tail.push(lang);
  }
  const rest = total - tiles.reduce((sum, [, v]) => sum + v, 0);
  if (rest > 0) tiles.push(["other", rest]);
  return { tiles, tail };
}

// ── squarified treemap (Bruls, Huizing & van Wijk) ───────────────────────────

type Rect = [number, number, number, number];

function* stack(sizes: number[], extent: number): Generator<[number, number]> {
  let off = 0;
  for (const s of sizes) {
    yield [s, off];
    off += s / extent;
  }
}

function row(sizes: number[], x: number, y: number, dx: number, dy: number): Rect[] {
  const covered = sizes.reduce((a, b) => a + b, 0);
  if (dx >= dy) {
    const width = covered / dy;
    return [...stack(sizes, width)].map(([s, off]): Rect => [x, y + off, width, s / width]);
  }
  const height = covered / dx;
  return [...stack(sizes, height)].map(([s, off]): Rect => [x + off, y, s / height, height]);
}

function leftover(sizes: number[], x: number, y: number, dx: number, dy: number): Rect {
  const covered = sizes.reduce((a, b) => a + b, 0);
  if (dx >= dy) {
    const width = covered / dy;
    return [x + width, y, dx - width, dy];
  }
  const height = covered / dx;
  return [x, y + height, dx, dy - height];
}

function worst(sizes: number[], x: number, y: number, dx: number, dy: number): number {
  return Math.max(
    ...row(sizes, x, y, dx, dy)
      .filter(([, , w, h]) => w && h)
      .map(([, , w, h]) => Math.max(w / h, h / w)),
  );
}

export function squarify(
  input: number[], x: number, y: number, dx: number, dy: number, normalized = false,
): Rect[] {
  let sizes = input.slice();
  if (!sizes.length) return [];
  if (!normalized) {
    // the algorithm works in area units: rescale so the values sum to the box
    const total = sizes.reduce((a, b) => a + b, 0);
    sizes = sizes.map((s) => (s * dx * dy) / total);
  }
  if (sizes.length === 1 || dx <= 0 || dy <= 0) return row(sizes, x, y, dx, dy);

  let i = 1;
  while (i < sizes.length && worst(sizes.slice(0, i), x, y, dx, dy) >= worst(sizes.slice(0, i + 1), x, y, dx, dy)) {
    i += 1;
  }

  const rest = leftover(sizes.slice(0, i), x, y, dx, dy);
  return row(sizes.slice(0, i), x, y, dx, dy).concat(
    squarify(sizes.slice(i), rest[0], rest[1], rest[2], rest[3], true),
  );
}

// ── SVG ──────────────────────────────────────────────────────────────────────

/** Interpolate the validated anchors so N tiles keep the ramp's ordering. */
function rampColour(rank: number, n: number): string {
  if (n <= 1) return RAMP[0];
  const t = (rank / (n - 1)) * (RAMP.length - 1);
  const lo = Math.min(Math.floor(t), RAMP.length - 2);
  const f = t - lo;
  const a = RAMP[lo], b = RAMP[lo + 1];
  let out = "#";
  for (let i = 0; i < 3; i++) {
    const av = parseInt(a.slice(1 + 2 * i, 3 + 2 * i), 16);
    const bv = parseInt(b.slice(1 + 2 * i, 3 + 2 * i), 16);
    out += roundHalfEven(av * (1 - f) + bv * f).toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Dark type on the pale end of the ramp, light type on the deep end. */
function ink(hex: string): string {
  const [r, g, b] = [0, 1, 2].map((i) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.62 ? m.DEEP_NAVY : m.INK;
}

export function render(tiles: Tile[], tail: string[], totalCommits: number, repos: number): string {
  const total = tiles.reduce((sum, [, v]) => sum + v, 0);
  const named = tiles.filter(([lang]) => lang !== "other");
  const rects = squarify(tiles.map(([, v]) => v), PAD, TOP, W - 2 * PAD, H - TOP - BOTTOM);

  const aria = tiles.map(([lang, v]) => `${lang} ${n0((v / total) * 100)}%`).join(" · ");

  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"`,
    `     role="img" aria-label="Languages by commit weight: ${esc(aria)}">`,
    "  <defs>",
    "    <style>",
    `      .head { font: 600 11px ${m.FONT}; fill: ${m.HEADING}; letter-spacing: 2px; }`,
    `      .foot { font: 500 11px ${m.FONT}; fill: ${m.INK_MUTED}; }`,
    `      .name { font: 700 14px ${m.FONT}; }`,
    `      .pct  { font: 500 12px ${m.FONT}; }`,
    `      .mini { font: 600 10px ${m.FONT}; }`,
    "    </style>",
    "  </defs>",
    "",
    `  <rect width="${W}" height="${H}" fill="${m.SURFACE}" rx="10" stroke="${m.RULE}" stroke-width="1"/>`,
    `  <text x="${PAD}" y="30" class="head">LANGUAGES&#160;BY&#160;COMMIT&#160;WEIGHT</text>`,
    `  <text x="${W - PAD}" y="30" class="foot" text-anchor="end">` +
      `${thousands(totalCommits)} commits · ${repos} repos · last ${DAYS_BACK} days</text>`,
  ];

  tiles.forEach(([lang, value], i) => {
    const [x, y, w, h] = rects[i];
    const share = value / total;
    const colour = lang === "other" ? OTHER : rampColour(i, named.length);
    const fg = lang === "other" ? m.INK_MUTED : ink(colour);
    const rx = x + GAP / 2, ry = y + GAP / 2;
    const rw = Math.max(w - GAP, 1), rh = Math.max(h - GAP, 1);
    const delay = pyf(+(0.08 * i).toFixed(2));

    out.push(
      "",
      `  <!-- ${lang} ${n1(share * 100)}% -->`,
      `  <g opacity="0">`,
      `    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${delay}s" fill="freeze"/>`,
      `    <rect x="${n1(rx)}" y="${n1(ry)}" width="${n1(rw)}" height="${n1(rh)}"` +
        ` rx="6" fill="${colour}"/>`,
    );

    const name = lang.toLowerCase();
    const big = name;
    const small = `${name} ${n0(share * 100)}%`;

    // monospace, so a character-count estimate is exact enough to place labels
    if (rh >= 46 && rw >= big.length * 8.4 + 26) {
      out.push(
        `    <text x="${n1(rx + 13)}" y="${n1(ry + 26)}" class="name" fill="${fg}">` +
          `${esc(big)}</text>`,
        `    <text x="${n1(rx + 13)}" y="${n1(ry + 44)}" class="pct" fill="${fg}"` +
          ` opacity="0.75">${n1(share * 100)}%</text>`,
      );
    } else if (rh >= 20 && rw >= small.length * 6.1 + 16) {
      out.push(
        `    <text x="${n1(rx + 8)}" y="${n1(ry + rh / 2 + 3.5)}" class="mini" fill="${fg}">` +
          `${esc(small)}</text>`,
      );
    } else if (rw >= 20 && rh >= small.length * 6.1 + 16) {
      // tall and narrow — turn the label on its side rather than drop it
      const tx = rx + rw / 2 + 3.5, ty = ry + rh - 8;
      out.push(
        `    <text x="${n1(tx)}" y="${n1(ty)}" class="mini" fill="${fg}"` +
          ` transform="rotate(-90 ${n1(tx)} ${n1(ty)})">${esc(small)}</text>`,
      );
    }

    out.push("  </g>");
  });

  if (tail.length) {
    const shown = tail.slice(0, 5).map((t) => t.toLowerCase());
    if (tail.length > 5) shown.push(`+${tail.length - 5} more`);
    out.push(
      `\n  <text x="${PAD}" y="${H - 12}" class="foot">other: ` +
        `${esc(shown.join(" · "))}</text>`,
    );
  }
  out.push(
    `  <text x="${W - PAD}" y="${H - 12}" class="foot" text-anchor="end">` +
      `area = commits × language mix</text>`,
  );
  out.push("</svg>");
  return out.join("\n") + "\n";
}
