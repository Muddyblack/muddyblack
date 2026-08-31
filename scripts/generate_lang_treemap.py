#!/usr/bin/env python3
"""Regenerate assets/languages.svg — a treemap of what I actually write.

Not the stock top-langs card. That one weighs a language by how many bytes of it
sit in your account, so a repo you pushed once in 2021 outranks the thing you
worked on all year. This weighs each repo by the commits *you* pushed to it in
the last 365 days, then splits that weight across the repo's language mix — so
tile area is keystrokes, not stored bytes.
"""

import json
import os
import re
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import marina

USERNAME  = os.environ.get("GITHUB_USERNAME", "Muddyblack")
TOKEN     = os.environ.get("GITHUB_TOKEN", "")
DAYS_BACK = 365
MAX_TILES = 7        # languages shown individually; the tail folds into "other"
MIN_SHARE = 0.015    # below this a language joins the tail

OUTPUT = os.path.join(os.path.dirname(__file__), "..", "assets", "languages.svg")

W, H       = 820, 322
PAD        = 24
TOP        = 52
BOTTOM     = 34
GAP        = 3       # surface showing between tiles

# Sequential cyan ramp, largest share → deepest — see marina.RAMP for the
# validation it passed against this surface.
RAMP  = marina.RAMP
OTHER = marina.RULE


# ── GitHub API ────────────────────────────────────────────────────────────────

def _get(path: str):
    req = Request(
        f"https://api.github.com{path}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "language-treemap-generator",
            **({"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}),
        },
    )
    try:
        with urlopen(req, timeout=30) as r:
            return json.loads(r.read()), r.headers.get("Link", "")
    except HTTPError as e:
        print(f"HTTP {e.code} {path}: {e.read().decode()[:120]}", file=sys.stderr)
        return None, ""


def my_commits(full_name: str, since: str) -> int:
    """Commit count without walking every page: ask for one per page and read
    the last-page number straight off the Link header."""
    data, link = _get(f"/repos/{full_name}/commits?author={USERNAME}&since={since}&per_page=1")
    if data is None:
        return 0
    last = re.search(r'[?&]page=(\d+)>; rel="last"', link)
    return int(last.group(1)) if last else len(data)


def collect() -> tuple[list[tuple[str, float]], int, int]:
    cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)
    since  = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")

    repos, page = [], 1
    while True:
        data, _ = _get(f"/users/{USERNAME}/repos?type=owner&sort=pushed&per_page=100&page={page}")
        if not data:
            break
        repos += data
        if len(data) < 100:
            break
        page += 1

    weights: dict[str, float] = {}
    total_commits = 0
    active = 0

    for repo in repos:
        if repo["fork"]:
            continue
        if datetime.fromisoformat(repo["pushed_at"].replace("Z", "+00:00")) < cutoff:
            continue

        commits = my_commits(repo["full_name"], since)
        if not commits:
            continue

        langs, _ = _get(f"/repos/{repo['full_name']}/languages")
        langs = langs or {}
        total_bytes = sum(langs.values())
        if not total_bytes:
            continue

        print(f"  {repo['name']:<32} {commits:>4} commits", file=sys.stderr)
        total_commits += commits
        active += 1
        for lang, size in langs.items():
            weights[lang] = weights.get(lang, 0.0) + commits * size / total_bytes

    ranked = sorted(weights.items(), key=lambda kv: -kv[1])
    return ranked, total_commits, active


def fold(ranked: list[tuple[str, float]]) -> tuple[list[tuple[str, float]], list[str]]:
    total = sum(v for _, v in ranked)
    head, tail = [], []
    for lang, value in ranked:
        if len(head) < MAX_TILES and value / total >= MIN_SHARE:
            head.append((lang, value))
        else:
            tail.append(lang)
    rest = total - sum(v for _, v in head)
    if rest > 0:
        head.append(("other", rest))
    return head, tail


# ── squarified treemap (Bruls, Huizing & van Wijk) ────────────────────────────

def _row(sizes, x, y, dx, dy):
    covered = sum(sizes)
    if dx >= dy:
        width = covered / dy
        return [(x, y + off, width, s / width) for s, off in _stack(sizes, width)]
    height = covered / dx
    return [(x + off, y, s / height, height) for s, off in _stack(sizes, height)]


def _stack(sizes, extent):
    off = 0.0
    for s in sizes:
        yield s, off
        off += s / extent


def _leftover(sizes, x, y, dx, dy):
    covered = sum(sizes)
    if dx >= dy:
        width = covered / dy
        return x + width, y, dx - width, dy
    height = covered / dx
    return x, y + height, dx, dy - height


def _worst(sizes, x, y, dx, dy):
    return max(max(w / h, h / w) for _, _, w, h in _row(sizes, x, y, dx, dy) if w and h)


def squarify(sizes, x, y, dx, dy, _normalized=False):
    sizes = [float(s) for s in sizes]
    if not sizes:
        return []
    if not _normalized:
        # the algorithm works in area units: rescale so the values sum to the box
        total = sum(sizes)
        sizes = [s * dx * dy / total for s in sizes]
    if len(sizes) == 1 or dx <= 0 or dy <= 0:
        return _row(sizes, x, y, dx, dy)

    i = 1
    while i < len(sizes) and _worst(sizes[:i], x, y, dx, dy) >= _worst(sizes[:i + 1], x, y, dx, dy):
        i += 1

    return _row(sizes[:i], x, y, dx, dy) + squarify(
        sizes[i:], *_leftover(sizes[:i], x, y, dx, dy), _normalized=True
    )


# ── SVG ───────────────────────────────────────────────────────────────────────

def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def ramp_colour(rank: int, n: int) -> str:
    """Interpolate the validated anchors so N tiles keep the ramp's ordering."""
    if n <= 1:
        return RAMP[0]
    t   = rank / (n - 1) * (len(RAMP) - 1)
    lo  = min(int(t), len(RAMP) - 2)
    f   = t - lo
    a, b = RAMP[lo], RAMP[lo + 1]
    mix = [round(int(a[1 + 2 * i:3 + 2 * i], 16) * (1 - f) + int(b[1 + 2 * i:3 + 2 * i], 16) * f)
           for i in range(3)]
    return "#" + "".join(f"{c:02X}" for c in mix)


def ink(hexcolour: str) -> str:
    """Dark type on the pale end of the ramp, light type on the deep end."""
    r, g, b = (int(hexcolour[1 + 2 * i:3 + 2 * i], 16) / 255 for i in range(3))
    lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    return marina.INK_DARK if lum > 0.62 else marina.INK


def render(tiles, tail, total_commits, repos) -> str:
    total = sum(v for _, v in tiles)
    named = [t for t in tiles if t[0] != "other"]

    sizes  = [v for _, v in tiles]
    rects  = squarify(sizes, PAD, TOP, W - 2 * PAD, H - TOP - BOTTOM)

    aria = " · ".join(f"{lang} {v / total * 100:.0f}%" for lang, v in tiles)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}"',
        f'     role="img" aria-label="Languages by commit weight: {esc(aria)}">',
        "  <defs>",
        "    <style>",
        f"      .head {{ font: 600 11px {marina.FONT}; fill: {marina.HEADING}; letter-spacing: 2px; }}",
        f"      .foot {{ font: 500 11px {marina.FONT}; fill: {marina.INK_MUTED}; }}",
        f"      .name {{ font: 700 14px {marina.FONT}; }}",
        f"      .pct  {{ font: 500 12px {marina.FONT}; }}",
        f"      .mini {{ font: 600 10px {marina.FONT}; }}",
        "    </style>",
        "  </defs>",
        "",
        f'  <rect width="{W}" height="{H}" fill="{marina.SURFACE}" rx="10" stroke="{marina.RULE}" stroke-width="1"/>',
        f'  <text x="{PAD}" y="30" class="head">LANGUAGES&#160;BY&#160;COMMIT&#160;WEIGHT</text>',
        f'  <text x="{W - PAD}" y="30" class="foot" text-anchor="end">'
        f'{total_commits:,} commits · {repos} repos · last {DAYS_BACK} days</text>',
    ]

    for i, ((lang, value), (x, y, w, h)) in enumerate(zip(tiles, rects)):
        share  = value / total
        colour = OTHER if lang == "other" else ramp_colour(i, len(named))
        fg     = marina.INK_MUTED if lang == "other" else ink(colour)
        rx, ry = x + GAP / 2, y + GAP / 2
        rw, rh = max(w - GAP, 1), max(h - GAP, 1)
        delay  = round(0.08 * i, 2)

        out += [
            "",
            f"  <!-- {lang} {share * 100:.1f}% -->",
            f'  <g opacity="0">',
            f'    <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="{delay}s" fill="freeze"/>',
            f'    <rect x="{rx:.1f}" y="{ry:.1f}" width="{rw:.1f}" height="{rh:.1f}"'
            f' rx="6" fill="{colour}"/>',
        ]

        name  = lang.lower()
        big   = f"{name}"
        small = f"{name} {share * 100:.0f}%"

        # monospace, so a character-count estimate is exact enough to place labels
        if rh >= 46 and rw >= len(big) * 8.4 + 26:
            out += [
                f'    <text x="{rx + 13:.1f}" y="{ry + 26:.1f}" class="name" fill="{fg}">'
                f'{esc(big)}</text>',
                f'    <text x="{rx + 13:.1f}" y="{ry + 44:.1f}" class="pct" fill="{fg}"'
                f' opacity="0.75">{share * 100:.1f}%</text>',
            ]
        elif rh >= 20 and rw >= len(small) * 6.1 + 16:
            out += [
                f'    <text x="{rx + 8:.1f}" y="{ry + rh / 2 + 3.5:.1f}" class="mini" fill="{fg}">'
                f'{esc(small)}</text>',
            ]
        elif rw >= 20 and rh >= len(small) * 6.1 + 16:
            # tall and narrow — turn the label on its side rather than drop it
            tx, ty = rx + rw / 2 + 3.5, ry + rh - 8
            out += [
                f'    <text x="{tx:.1f}" y="{ty:.1f}" class="mini" fill="{fg}"'
                f' transform="rotate(-90 {tx:.1f} {ty:.1f})">{esc(small)}</text>',
            ]

        out.append("  </g>")

    if tail:
        shown = [t.lower() for t in tail[:5]]
        if len(tail) > 5:
            shown.append(f"+{len(tail) - 5} more")
        out.append(
            f'\n  <text x="{PAD}" y="{H - 12}" class="foot">other: '
            f'{esc(" · ".join(shown))}</text>'
        )
    out.append(
        f'  <text x="{W - PAD}" y="{H - 12}" class="foot" text-anchor="end">'
        f'area = commits × language mix</text>'
    )
    out.append("</svg>")
    return "\n".join(out) + "\n"


def main():
    print(f"Scanning {USERNAME}'s repos (last {DAYS_BACK} days)…", file=sys.stderr)
    ranked, total_commits, repos = collect()
    if not ranked:
        print("No language data — aborting to avoid overwriting with empty data.", file=sys.stderr)
        sys.exit(1)

    tiles, tail = fold(ranked)
    total = sum(v for _, v in tiles)
    print()
    for lang, value in tiles:
        print(f"  {lang:<14} {value / total * 100:5.1f}%")
    if tail:
        print(f"  (folded: {', '.join(tail)})")

    out_path = os.path.normpath(OUTPUT)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(render(tiles, tail, total_commits, repos))
    print(f"\nWritten → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
