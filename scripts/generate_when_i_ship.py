#!/usr/bin/env python3
"""Regenerate assets/when-i-ship.svg from the last 365 days of GitHub commits."""

import json
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen

USERNAME = os.environ.get("GITHUB_USERNAME", "Muddyblack")
TOKEN = os.environ.get("GITHUB_TOKEN", "")
DAYS_BACK = 365
TZ_OFFSET = timezone(timedelta(hours=1))  # UTC+1 (Germany / France)

OUTPUT = os.path.join(os.path.dirname(__file__), "..", "assets", "when-i-ship.svg")

SLOTS = [
    ("night",     0,  6),   # Nacht:      00–06
    ("morning",   6,  11),  # Morgen:     06–11
    ("day",       11, 15),  # Mittag:     11–15
    ("afternoon", 15, 18),  # Nachmittag: 15–18
    ("evening",   18, 23),  # Abend:      18–23
    # hour 23 → "night" via classify() fallback
]

BAR_MAX_W = 420
BAR_H     = 14
BAR_X     = 120
ROW_STEP  = 40


# ── GitHub API ────────────────────────────────────────────────────────────────

def _request(url: str):
    headers = {
        "Accept": "application/vnd.github.v3+json",
        "User-Agent": "when-i-ship-generator",
    }
    if TOKEN:
        headers["Authorization"] = f"Bearer {TOKEN}"
    req = Request(url, headers=headers)
    try:
        with urlopen(req, timeout=30) as r:
            return json.loads(r.read()), r.headers.get("Link", "")
    except HTTPError as e:
        body = e.read().decode()
        print(f"HTTP {e.code} {url}: {body[:120]}", file=sys.stderr)
        return [], ""


def _paginate(path: str, query: str = ""):
    page = 1
    while True:
        sep = "&" if "?" in query else "?"
        data, link = _request(f"https://api.github.com{path}{query}{sep}per_page=100&page={page}")
        if not data:
            break
        yield from data
        if 'rel="next"' not in link:
            break
        page += 1


# ── Commit collection ─────────────────────────────────────────────────────────

def collect_hours() -> list[int]:
    since = (datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)
    hours: list[int] = []

    for repo in _paginate(f"/users/{USERNAME}/repos", "?type=public&sort=pushed"):
        pushed = datetime.fromisoformat(repo["pushed_at"].replace("Z", "+00:00"))
        if pushed < cutoff:
            # repos are sorted by pushed desc; first one older than window → stop
            break

        full_name = repo["full_name"]
        print(f"  {full_name}", file=sys.stderr)

        for commit in _paginate(f"/repos/{full_name}/commits", f"?author={USERNAME}&since={since}"):
            raw = commit["commit"]["author"]["date"]
            dt = datetime.fromisoformat(raw.replace("Z", "+00:00")).astimezone(TZ_OFFSET)
            hours.append(dt.hour)

    return hours


def classify(hour: int) -> str:
    for name, start, end in SLOTS:
        if start <= hour < end:
            return name
    return "night"


# ── SVG generation ────────────────────────────────────────────────────────────

def _svg(counts: dict[str, int], total: int) -> str:
    rows = sorted(SLOTS, key=lambda s: counts.get(s[0], 0), reverse=True)
    n    = len(rows)
    h    = 32 + n * ROW_STEP + 48   # header + rows + footer

    aria = " · ".join(
        f"{name} {round(counts.get(name, 0) / total * 100)}%" if total else "0%"
        for name, *_ in rows
    )

    out: list[str] = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="640" height="{h}" viewBox="0 0 640 {h}"',
        f'     role="img" aria-label="When I ship: {aria}">',
        "  <defs>",
        '    <linearGradient id="barGrad" x1="0" y1="0" x2="1" y2="0">',
        '      <stop offset="0%"  stop-color="#6366F1"/>',
        '      <stop offset="100%" stop-color="#A855F7"/>',
        "    </linearGradient>",
        '    <linearGradient id="shimmer" x1="0" y1="0" x2="1" y2="0">',
        '      <stop offset="0%"   stop-color="#FFFFFF" stop-opacity="0"/>',
        '      <stop offset="50%"  stop-color="#FFFFFF" stop-opacity="0.35"/>',
        '      <stop offset="100%" stop-color="#FFFFFF" stop-opacity="0"/>',
        "    </linearGradient>",
    ]

    for i, (name, *_) in enumerate(rows):
        pct   = counts.get(name, 0) / total if total else 0
        bar_w = round(BAR_MAX_W * pct, 1)
        ty    = 32 + i * ROW_STEP   # track y
        delay = round(0.10 + i * 0.15, 2)
        out += [
            f'    <clipPath id="clip{i}"><rect x="{BAR_X}" y="{ty}" width="0" height="{BAR_H}" rx="7">',
            f'      <animate attributeName="width" from="0" to="{bar_w}" dur="0.9s" begin="{delay}s" fill="freeze"',
            f'               calcMode="spline" keySplines="0.4 0 0.2 1"/>',
            f"    </rect></clipPath>",
        ]

    out += [
        "    <style>",
        "      .label { font: 600 13px 'JetBrains Mono', ui-monospace, monospace; fill: #C9D1D9; }",
        "      .pct   { font: 600 13px 'JetBrains Mono', ui-monospace, monospace; fill: #8B95A7; }",
        "      .head  { font: 600 11px 'JetBrains Mono', ui-monospace, monospace; fill: #6366F1; letter-spacing: 2px; }",
        "      .track { fill: #161B22; }",
        "    </style>",
        "  </defs>",
        "",
        f'  <rect width="640" height="{h}" fill="#0D1117" rx="10"/>',
        '  <text x="24" y="22" class="head">WHEN&#160;I&#160;SHIP</text>',
    ]

    for i, (name, *_) in enumerate(rows):
        pct      = counts.get(name, 0) / total if total else 0
        pct_str  = f"{round(pct * 100)}%"
        bar_w    = round(BAR_MAX_W * pct, 1)
        ty       = 32 + i * ROW_STEP
        text_y   = ty + BAR_H
        s_dur    = round(2.2 + i * 0.4, 1)
        s_begin  = round(1.0 + i * 0.2, 1)

        out += [
            "",
            f"  <!-- {name} : {pct_str} -->",
            f'  <text x="24" y="{text_y}" class="label">{name}</text>',
            f'  <rect x="{BAR_X}" y="{ty}" width="{BAR_MAX_W}" height="{BAR_H}" rx="7" class="track"/>',
            f'  <g clip-path="url(#clip{i})">',
            f'    <rect x="{BAR_X}" y="{ty}" width="{BAR_MAX_W}" height="{BAR_H}" rx="7" fill="url(#barGrad)"/>',
            f'    <rect x="-80" y="{ty}" width="80" height="{BAR_H}" fill="url(#shimmer)">',
            f'      <animate attributeName="x" from="{BAR_X}" to="{BAR_X + BAR_MAX_W}" dur="{s_dur}s" begin="{s_begin}s" repeatCount="indefinite"/>',
            "    </rect>",
            "  </g>",
            f'  <text x="556" y="{text_y}" class="pct">{pct_str}</text>',
        ]

    footer_y = h - 16
    out += [
        "",
        f'  <text x="24" y="{footer_y}" class="pct">utc+1 · germany / france · last {DAYS_BACK} days · {total} commits</text>',
        "</svg>",
    ]

    return "\n".join(out) + "\n"


# ── Entry point ───────────────────────────────────────────────────────────────

def main():
    print(f"Scanning {USERNAME}'s public repos (last {DAYS_BACK} days)…", file=sys.stderr)
    hours = collect_hours()
    print(f"\n{len(hours)} commits collected", file=sys.stderr)

    if not hours:
        print("No commits found — aborting to avoid overwriting with empty data.", file=sys.stderr)
        sys.exit(1)

    counts: dict[str, int] = defaultdict(int)
    for h in hours:
        counts[classify(h)] += 1

    total = sum(counts.values())
    for name, *_ in sorted(SLOTS, key=lambda s: counts.get(s[0], 0), reverse=True):
        n   = counts.get(name, 0)
        pct = n / total * 100
        print(f"  {name:<10} {n:4d}  ({pct:.0f}%)")

    svg      = _svg(counts, total)
    out_path = os.path.normpath(OUTPUT)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"\nWritten → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
