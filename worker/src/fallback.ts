// The last line of defence: something that is still an SVG.
//
// The failure this exists for is specific. An <img> in a README can only ever
// render an image; anything else — a 500 page, a plain-text error, a timed-out
// connection — collapses to the alt text. So a route that serves an image must
// never answer with something that is not one, however badly the build went.
// This is what /card.svg and /languages.svg fall back to once both the live
// build and the cache have failed them.
//
// Deliberately built from nothing: no GitHub data, no avatar, no fetch. If it
// could fail it would defeat its own purpose.

import * as m from "./marina";

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A placeholder card, sized to the slot it is standing in for. */
export function placeholder(title: string, note: string, w = 820, h = 220): string {
  const cx = w / 2;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"`,
    ` viewBox="0 0 ${w} ${h}" role="img" aria-label="${esc(title)}">`,
    `  <rect width="${w}" height="${h}" fill="${m.SURFACE}" rx="10"`,
    ` stroke="${m.RULE}" stroke-width="1"/>`,
    `  <text x="${cx}" y="${h / 2 - 14}" text-anchor="middle"`,
    ` font-family="${m.FONT}" font-size="19" fill="${m.HEADING}">${esc(title)}</text>`,
    `  <text x="${cx}" y="${h / 2 + 16}" text-anchor="middle"`,
    ` font-family="${m.FONT}" font-size="13" fill="${m.INK_MUTED}">${esc(note)}</text>`,
    `  <rect x="${cx - 60}" y="${h / 2 + 34}" width="120" height="2" rx="1" fill="${m.RULE}">`,
    `    <animate attributeName="opacity" values="0.25;1;0.25" dur="1.8s" repeatCount="indefinite"/>`,
    `  </rect>`,
    `</svg>`,
  ].join("");
}
