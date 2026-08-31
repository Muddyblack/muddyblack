"""Shared SVG fragments — one definition for anything drawn in more than one place.

A README SVG has to be wholly self-contained: GitHub serves it through camo, so
it renders inside an <img>, where <use href="other.svg#id"> and <image> are both
blocked. Repeating markup across files is therefore unavoidable at *render*
time — but it does not have to be repeated in the source. Everything here is
emitted into whichever file needs it, so the palette lives in exactly one place.

Only the fragments that genuinely appear twice live here (the sweep divider and
the prompt line, both of which the fastfetch card also draws). The bespoke
dividers in assets/dividers/ are hand-authored and stay that way.
"""

import marina

# The shell prompt, as a run of coloured segments. The offsets are hand-tuned
# rather than a strict monospace advance — the punctuation gets a little air —
# so they are carried explicitly instead of being computed.
PROMPT = [
    ("muddyblack", marina.TEAL, None,  0),
    ("@",          marina.CYAN, "0.7", 74),
    ("nixos",      "#7BFFD9",   None,  84),
    (":",          marina.CYAN, "0.7", 128),
    ("~",          marina.CYAN, None,  136),
    ("❯",     marina.TEAL, None,  150),
]
PROMPT_END  = 170      # where the trailing rule starts, relative to the run
PROMPT_FONT = ("JetBrains Mono, ui-monospace, SFMono-Regular, "
               "Menlo, Consolas, monospace")


def sweep_gradient(gid: str = "sweep") -> list[str]:
    """The travelling highlight."""
    return [
        f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="0">',
        '  <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0"/>',
        '  <stop offset="50%"  stop-color="#FFFFFF" stop-opacity="0.9"/>',
        '  <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>',
        "</linearGradient>",
    ]


def rule_gradient(gid: str = "rule") -> list[str]:
    """Transparent at both ends, teal in the middle — the divider's own line."""
    return [
        f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="0">',
        f'  <stop offset="0%"   stop-color="{marina.CYAN}" stop-opacity="0"/>',
        f'  <stop offset="50%"  stop-color="{marina.TEAL}" stop-opacity="1"/>',
        f'  <stop offset="100%" stop-color="{marina.CYAN}" stop-opacity="0"/>',
        "</linearGradient>",
    ]


def prompt_fade(gid: str = "promptFade") -> list[str]:
    """The rule trailing off to the right of the prompt."""
    return [
        f'<linearGradient id="{gid}" x1="0" y1="0" x2="1" y2="0">',
        f'  <stop offset="0%"   stop-color="{marina.CYAN}" stop-opacity="0.55"/>',
        f'  <stop offset="85%"  stop-color="{marina.CYAN}" stop-opacity="0.18"/>',
        f'  <stop offset="100%" stop-color="{marina.CYAN}" stop-opacity="0"/>',
        "</linearGradient>",
    ]


def prompt_run(x: float, y: float, cls: str | None = None) -> tuple[list[str], float]:
    """The `muddyblack@nixos:~ ❯` run. Returns its lines and where the rule starts."""
    out = []
    for text, colour, alpha, dx in PROMPT:
        attrs = f' class="{cls}"' if cls else ""
        attrs += f' fill="{colour}"'
        if alpha:
            attrs += f' opacity="{alpha}"'
        body = text.replace("&", "&amp;").replace("<", "&lt;")
        body = body.replace("❯", "&#10095;")
        out.append(f'<text x="{x + dx:g}" y="{y}"{attrs}>{body}</text>')
    return out, x + PROMPT_END


def cursor(x: float, y: float) -> list[str]:
    """Blinking block cursor."""
    return [
        f'<rect x="{x:g}" y="{y:g}" width="8" height="12" rx="1" fill="{marina.TEAL}">',
        '  <animate attributeName="opacity" values="1;1;0;0" dur="1.1s" repeatCount="indefinite"/>',
        "</rect>",
    ]


# ── standalone divider files ─────────────────────────────────────────────────

def _indent(lines: list[str], pad: str) -> str:
    return "\n".join(pad + line for line in lines)


def divider_svg(width: int = 900) -> str:
    band = 140
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="14" \
viewBox="0 0 {width} 14" role="presentation">
  <defs>
{_indent(rule_gradient("d"), "    ")}
{_indent(sweep_gradient("s"), "    ")}
  </defs>
  <rect x="0" y="6" width="{width}" height="2" fill="url(#d)" rx="1"/>
  <rect y="6" width="{band}" height="2" fill="url(#s)" rx="1">
    <animate attributeName="x" from="-{band}" to="{width}" dur="3.6s" repeatCount="indefinite"/>
  </rect>
  <circle cx="{width // 2}" cy="7" r="3" fill="{marina.TEAL}">
    <animate attributeName="opacity" values="0.3;1;0.3" dur="2.2s" repeatCount="indefinite"/>
  </circle>
</svg>
"""


def terminal_divider_svg(width: int = 900) -> str:
    texts, rule_x = prompt_run(2, 15)
    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="22" \
viewBox="0 0 {width} 22" role="presentation">
  <defs>
{_indent(prompt_fade("tfade"), "    ")}
  </defs>
  <g font-family="{PROMPT_FONT}"
     font-size="12" font-weight="500">
{_indent(texts, "    ")}
  </g>
  <rect x="{rule_x:g}" y="10.4" width="{width - 28 - rule_x:g}" height="1.2" rx="0.6" \
fill="url(#tfade)"/>
{_indent(cursor(width - 22, 5), "  ")}
</svg>
"""
