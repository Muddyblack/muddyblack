// Midnight Marina — mirrors scripts/marina.py.
// Kept in sync by hand; it is a dozen constants and it changes when the theme
// changes, which is approximately never.

export const MIDNIGHT_BLUE = "#03233A";
export const NAVY_BLUE     = "#021A2C";
export const DEEP_NAVY     = "#01121F";
export const BORDER        = "#254D6A";

export const CYAN   = "#0EADCF";
export const TEAL   = "#55FFCC";
export const BLUE   = "#22D4FF";
export const PURPLE = "#AA82FF";
export const YELLOW = "#FFE073";
export const RED    = "#D95C5C";
export const MINT   = "#44FFB1";
export const WHITE  = "#CBE0F0";
export const MUTED  = "#8295A0";

export const ACCENTS = [CYAN, TEAL, BLUE, PURPLE, YELLOW, RED, MINT];

export const SURFACE   = MIDNIGHT_BLUE;
export const TRACK     = NAVY_BLUE;
export const RULE      = BORDER;
export const INK       = WHITE;
export const INK_MUTED = MUTED;
export const HEADING   = CYAN;

export const RAMP = ["#0B5A70", "#0E7D99", CYAN, "#3FCDE8", "#7FE3F5", "#BFF2FB"];

export const FONT = "'JetBrains Mono', ui-monospace, monospace";

// The prompt run, offsets included — see scripts/svgkit.py.
export const PROMPT: [string, string, string | null, number][] = [
  ["muddyblack", TEAL, null,  0],
  ["@",          CYAN, "0.7", 74],
  ["nixos",      "#7BFFD9", null, 84],
  [":",          CYAN, "0.7", 128],
  ["~",          CYAN, null,  136],
  ["❯",     TEAL, null,  150],
];
export const PROMPT_END = 170;
