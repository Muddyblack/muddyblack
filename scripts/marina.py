"""Midnight Marina — the one place the profile's colours are defined.

Lifted from the theme itself (Muddyblack/midnight-marina-{vscode,zed,obsidian}),
so the README, the editor, the notes app and the terminal all read as one thing.
Every generated SVG imports from here; retheming is this file and nothing else.
"""

# ── core palette (verbatim from midnight-marina.css) ──────────────────────────
MIDNIGHT_BLUE = "#03233A"   # background-primary
NAVY_BLUE     = "#021A2C"   # background-secondary
DEEP_NAVY     = "#01121F"   # deepest surface
BORDER        = "#254D6A"   # background-modifier-border
FAINT         = "#4A7A9A"   # text-faint

CYAN   = "#0EADCF"          # marina-cyan   — the primary accent
TEAL   = "#55FFCC"          # marina-teal   — the secondary accent
BLUE   = "#22D4FF"          # marina-blue
PURPLE = "#AA82FF"          # marina-purple
YELLOW = "#FFE073"          # marina-yellow
RED    = "#D95C5C"          # marina-red
MINT   = "#44FFB1"          # 7th accent, zed only
WHITE  = "#CBE0F0"          # marina-white  — normal text
MUTED  = "#8295A0"          # marina-muted  — secondary text

# The theme's own accent array, in its own order (zed: style.accents).
ACCENTS = [CYAN, TEAL, BLUE, PURPLE, YELLOW, RED, MINT]

# ── roles the charts speak in ─────────────────────────────────────────────────
SURFACE   = MIDNIGHT_BLUE   # card background
TRACK     = NAVY_BLUE       # empty bar / inset background
RULE      = BORDER          # hairlines and dividers
INK       = WHITE           # primary text
INK_MUTED = MUTED           # secondary text
INK_DARK  = DEEP_NAVY       # text placed on a pale fill
HEADING   = CYAN            # section labels, keys

# Sequential cyan ramp, deepest = largest. Validated as an ordinal ramp against
# SURFACE: monotone lightness, adjacent ΔL ≥ 0.06, single hue (13° spread),
# deep end 2.08:1 against the surface.
RAMP = ["#0B5A70", "#0E7D99", CYAN, "#3FCDE8", "#7FE3F5", "#BFF2FB"]

FONT = "'JetBrains Mono', ui-monospace, monospace"
