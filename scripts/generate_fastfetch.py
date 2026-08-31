#!/usr/bin/env python3
"""Regenerate assets/fastfetch.svg — a fetch-style ID card for the GitHub profile.

The "machine" being fetched is the GitHub account: uptime is the account age,
packages are the repos, and the commit line is real throughput. Anything that
describes the actual desktop (shell, WM, terminal) lives in STATIC below and is
the one part you edit by hand.

Two things ride along in the same card: contribution totals and streaks, from
the GraphQL contributions calendar (needs a token; omitted without one), and the
hour-of-day distribution of every commit in the window, drawn as a 24h dial.

Every animation is written so the *static* state is already correct: rests hold
the final value and animations run from t=0 with a leading hold, so a renderer
that ignores SMIL draws the true card rather than an empty one.
"""

import base64
import json
import math
import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen

import marina
import svgkit

USERNAME    = os.environ.get("GITHUB_USERNAME", "Muddyblack")
TOKEN       = os.environ.get("GITHUB_TOKEN", "")
CONFIG_REPO = os.environ.get("NIXOS_REPO", "Muddyblack/NixOS")
DAYS_BACK   = 365

OUTPUT = os.environ.get(
    "OUTPUT", os.path.join(os.path.dirname(__file__), "..", "assets", "fastfetch.svg")
)

# Hand-maintained rows — the parts of the rice no API knows about.
STATIC = {
    "Kernel":   "linux-cachyos · lto",
    "Shell":    "zsh · powerlevel10k",
    "DE / WM":  "kde plasma · hyprland",
    "Terminal": "ghostty",
    "Editor":   "nvim · vscode · claude",
    "Locale":   "🇩🇪 · 🇫🇷 · 🇬🇧",
}

W          = 820
LEFT       = 88                 # logo edge; the card's content margin
RIGHT      = W - 88
LOGO_SIZE  = 150
TEXT_X     = 272                # key column
VAL_X      = 360                # value column
ROW_STEP   = 24
GAP_STEP   = 18
HEAD_Y     = 62                 # "user@host" baseline
BODY_Y     = HEAD_Y + 26        # first row sits one step below this

TZ_OFFSET  = timezone(timedelta(hours=1))   # UTC+1 (Germany / France)

DIAL_R     = 46
DIAL_HUB   = 13
BAND_H     = 158


# ── GitHub REST ───────────────────────────────────────────────────────────────

def _get(path: str):
    req = Request(
        f"https://api.github.com{path}",
        headers={
            "Accept": "application/vnd.github+json",
            "User-Agent": "fastfetch-card-generator",
            **({"Authorization": f"Bearer {TOKEN}"} if TOKEN else {}),
        },
    )
    try:
        with urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except HTTPError as e:
        print(f"HTTP {e.code} {path}: {e.read().decode()[:120]}", file=sys.stderr)
        return None


def _paginate(path: str, query: str = ""):
    page = 1
    while True:
        sep = "&" if "?" in query else "?"
        data = _get(f"{path}{query}{sep}per_page=100&page={page}")
        if not data:
            return
        yield from data
        if len(data) < 100:
            return
        page += 1


def _graphql(query: str, variables: dict):
    body = json.dumps({"query": query, "variables": variables}).encode()
    req = Request(
        "https://api.github.com/graphql",
        data=body,
        headers={
            "Content-Type": "application/json",
            "User-Agent": "fastfetch-card-generator",
            "Authorization": f"Bearer {TOKEN}",
        },
    )
    try:
        with urlopen(req, timeout=45) as r:
            payload = json.loads(r.read())
    except HTTPError as e:
        print(f"HTTP {e.code}: {e.read().decode()[:200]}", file=sys.stderr)
        return None
    if "errors" in payload:
        print(f"GraphQL: {payload['errors']}", file=sys.stderr)
        return None
    return payload["data"]


# ── Contribution calendar ─────────────────────────────────────────────────────

def created_at() -> datetime:
    data = _graphql("query($l:String!){user(login:$l){createdAt}}", {"l": USERNAME})
    if not data:
        print("Could not read the account — aborting.", file=sys.stderr)
        sys.exit(1)
    return datetime.fromisoformat(data["user"]["createdAt"].replace("Z", "+00:00"))


def calendar(start: datetime) -> dict[date, int]:
    """Every contribution day since the account opened, in one request."""
    now, windows = datetime.now(timezone.utc), []
    # floor to midnight: a mid-day `from` makes the calendar start the next day,
    # which silently drops the signup day itself
    cursor = start.replace(hour=0, minute=0, second=0, microsecond=0)
    while cursor < now:
        end = min(cursor.replace(year=cursor.year + 1), now)
        windows.append((cursor, end))
        cursor = end

    fields = "\n".join(
        f'    w{i}:contributionsCollection(from:"{a:%Y-%m-%dT%H:%M:%SZ}",to:"{b:%Y-%m-%dT%H:%M:%SZ}")'
        "{contributionCalendar{weeks{contributionDays{date contributionCount}}}}"
        for i, (a, b) in enumerate(windows)
    )
    data = _graphql("query($l:String!){user(login:$l){\n" + fields + "\n}}", {"l": USERNAME})
    if not data:
        print("Could not read the contribution calendar — aborting.", file=sys.stderr)
        sys.exit(1)

    days: dict[date, int] = {}
    for window in data["user"].values():
        for week in window["contributionCalendar"]["weeks"]:
            for day in week["contributionDays"]:
                d = date.fromisoformat(day["date"])
                days[d] = max(days.get(d, 0), day["contributionCount"])
    return days


def streaks(days: dict[date, int]):
    first, last = min(days), max(days)
    total = sum(days.values())

    best, best_span = 0, (first, first)
    run, run_start = 0, None
    d = first
    while d <= last:
        if days.get(d, 0) > 0:
            run_start = run_start or d
            run += 1
            if run > best:
                best, best_span = run, (run_start, d)
        else:
            run, run_start = 0, None
        d += timedelta(days=1)

    # today counts only if it has contributions, but an empty today does not
    # break a streak that ran through yesterday
    today  = date.today()
    cursor = today if days.get(today, 0) > 0 else today - timedelta(days=1)
    current, end = 0, cursor
    while days.get(cursor, 0) > 0:
        current += 1
        cursor -= timedelta(days=1)
    cur_span = (cursor + timedelta(days=1), end) if current else None

    return total, (first, last), best, best_span, current, cur_span


def contributions():
    if not TOKEN:
        return None
    return streaks(calendar(created_at()))


# ── Facts ─────────────────────────────────────────────────────────────────────

def uptime(created: str) -> str:
    start = datetime.fromisoformat(created.replace("Z", "+00:00"))
    now   = datetime.now(timezone.utc)
    years = now.year - start.year - ((now.month, now.day) < (start.month, start.day))
    anniv = start.replace(year=start.year + years)
    days  = (now - anniv).days
    parts = []
    if years:
        parts.append(f"{years} year{'s' if years != 1 else ''}")
    parts.append(f"{days} day{'s' if days != 1 else ''}")
    return ", ".join(parts)


def nixpkgs_channel() -> str:
    """Read the nixpkgs ref straight out of the config repo's flake.nix."""
    blob = _get(f"/repos/{CONFIG_REPO}/contents/flake.nix")
    if not blob or "content" not in blob:
        return "unstable"
    text  = base64.b64decode(blob["content"]).decode("utf-8", "replace")
    match = re.search(r"nixpkgs\.url\s*=\s*\"github:[^/]+/nixpkgs/([^\"]+)\"", text)
    return match.group(1).replace("nixos-", "") if match else "unstable"


def commit_hours() -> list[int]:
    """Every commit I authored in the window, as a local hour-of-day.

    Repos come back sorted by push date, so the first one that fell out of the
    window ends the walk.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=DAYS_BACK)
    since  = cutoff.strftime("%Y-%m-%dT%H:%M:%SZ")
    hours: list[int] = []

    for repo in _paginate(f"/users/{USERNAME}/repos", "?type=public&sort=pushed"):
        if datetime.fromisoformat(repo["pushed_at"].replace("Z", "+00:00")) < cutoff:
            break
        print(f"  {repo['full_name']}", file=sys.stderr)
        for commit in _paginate(f"/repos/{repo['full_name']}/commits",
                                f"?author={USERNAME}&since={since}"):
            when = datetime.fromisoformat(
                commit["commit"]["author"]["date"].replace("Z", "+00:00")
            ).astimezone(TZ_OFFSET)
            hours.append(when.hour)

    return hours


def collect(total_commits: int):
    user = _get(f"/users/{USERNAME}")
    if not user:
        print("Could not read user — aborting.", file=sys.stderr)
        sys.exit(1)

    repos   = list(_paginate(f"/users/{USERNAME}/repos", "?type=owner"))
    own     = [r for r in repos if not r["fork"]]
    widgets = [r for r in own if r["name"].startswith("kde-")]
    stars   = sum(r["stargazers_count"] for r in own)

    # the OS *is* the person here; the monogram is cut from the same name
    name = user.get("name") or USERNAME
    who  = f"{name} · {user['location'].lower()}" if user.get("location") else name

    gap = ("", "")

    # three groups, thin rule between: the machine, the account, the activity
    rows = [
        ("OS",       who),
        ("Distro",   f"NixOS {nixpkgs_channel()} · x86_64"),
        ("Kernel",   STATIC["Kernel"]),
        ("Shell",    STATIC["Shell"]),
        ("DE / WM",  STATIC["DE / WM"]),
        ("Terminal", STATIC["Terminal"]),
        ("Editor",   STATIC["Editor"]),
        gap,
        ("Host",     f"github.com/{USERNAME}"),
        ("Uptime",   uptime(user["created_at"])),
        ("Packages", f"{len(own)} repos · {len(widgets)} kde widgets"),
    ]
    if stars:
        rows.append(("Stars", f"{stars}"))
    rows += [
        ("Locale",   STATIC["Locale"]),
        gap,
        ("Commits",  f"{total_commits:,} · last {DAYS_BACK} days · utc+1"),
    ]
    return rows, avatar(user["avatar_url"])


# ── SVG helpers ───────────────────────────────────────────────────────────────

def esc(s: str) -> str:
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def mix(a: str, b: str, t: float) -> str:
    out = [round(int(a[1 + 2 * i:3 + 2 * i], 16) * (1 - t)
                 + int(b[1 + 2 * i:3 + 2 * i], 16) * t) for i in range(3)]
    return "#" + "".join(f"{c:02X}" for c in out)


def daylight(hour: float) -> float:
    """0 at 01:00 (deepest night), 1 at 13:00 (peak day)."""
    return (math.cos((hour - 13) / 24 * 2 * math.pi) + 1) / 2


def hour_colour(hour: int) -> str:
    return mix(marina.RAMP[1], marina.TEAL, daylight(hour))


FLAME = ("M0,-10 C4.2,-5.6 7.3,-2.2 7.3,2 A7.3,7.3 0 0 1 -7.3,2 "
         "C-7.3,-1.3 -4.2,-3.1 -2.2,-5.8 C-1.6,-3.3 -0.4,-2 0.7,-3.1 "
         "C1.1,-5.8 0.4,-8.2 0,-10 Z")


def avatar(url: str) -> str:
    """The profile picture as a data: URI — the SVG has to stand alone."""
    req = Request(f"{url}&s=400" if "?" in url else f"{url}?s=400",
                  headers={"User-Agent": "fastfetch-card-generator"})
    with urlopen(req, timeout=30) as r:
        return ("data:image/png;base64,"
                + base64.b64encode(r.read()).decode())


def _hexagon(cx: float, cy: float, r: float) -> str:
    """Pointy-top hexagon, as polygon points."""
    return " ".join(
        f"{cx + r * math.cos(a):.2f},{cy + r * math.sin(a):.2f}"
        for a in (math.radians(60 * i - 90) for i in range(6))
    )


def _logo(x: float, y: float, size: float, pic: str) -> list[str]:
    """The profile picture cut to a hexagon, with the card's accent as its edge.

    Sized to the hexagon's height, not its width: the avatar's artwork is round
    inside a square frame, and at √3·r that circle only reaches the edge
    midpoints, leaving a gap at each of the six points. 2·r is the circumradius
    diameter, so the circle covers the whole hexagon and the clip crops the
    overflow. The stroke sits on top so the cut edge stays crisp.
    """
    cx, cy = x + size / 2, y + size / 2
    r      = size / 2
    w      = 2 * r

    return [
        '  <g aria-hidden="true">',
        f'    <clipPath id="hexClip"><polygon points="{_hexagon(cx, cy, r)}"/></clipPath>',
        f'    <image href="{pic}" x="{cx - w / 2:.1f}" y="{cy - w / 2:.1f}"'
        f' width="{w:.1f}" height="{w:.1f}" clip-path="url(#hexClip)"'
        ' preserveAspectRatio="xMidYMid slice"/>',
        f'    <polygon points="{_hexagon(cx, cy, r)}" fill="none"'
        f' stroke="{marina.CYAN}" stroke-width="3" stroke-linejoin="round"/>',
        "  </g>",
    ]


# ── the 24h dial ──────────────────────────────────────────────────────────────

def _dial(cx: float, cy: float, by_hour: list[int]) -> list[str]:
    """24 spokes, midnight at the top, clockwise. Kept as an outline rather
    than a filled disc so it sits in the card instead of on top of it."""
    peak = max(by_hour) or 1
    rim  = DIAL_R + 7

    out = ["", "  <!-- commits by hour of day -->"]

    # the rim doubles as the day/night read: dim over the night hours, lit over
    # the daylight ones. Two arcs, no fill, so there is no hard half-disc edge.
    for lo, hi, colour, alpha in ((18, 30, marina.RAMP[0], 0.5), (6, 18, marina.CYAN, 0.5)):
        a0, a1 = math.radians(-90 + lo * 15), math.radians(-90 + hi * 15)
        out.append(
            f'  <path d="M{cx + rim * math.cos(a0):.1f},{cy + rim * math.sin(a0):.1f}'
            f' A{rim},{rim} 0 0 1 {cx + rim * math.cos(a1):.1f},{cy + rim * math.sin(a1):.1f}"'
            f' fill="none" stroke="{colour}" stroke-width="1.5" opacity="{alpha}"'
            ' stroke-linecap="round"/>'
        )

    for hour, count in enumerate(by_hour):
        angle = math.radians(-90 + hour * 15)
        # every hour keeps a short stub, so a quiet hour reads as "quiet"
        # rather than as a gap in the dial
        end   = DIAL_HUB + 3 + (count / peak) * (DIAL_R - DIAL_HUB - 3)
        x1, y1 = cx + DIAL_HUB * math.cos(angle), cy + DIAL_HUB * math.sin(angle)
        x2, y2 = cx + end * math.cos(angle), cy + end * math.sin(angle)
        delay  = round(0.2 + hour * 0.02, 3)
        dur    = round(delay + 0.5, 3)
        out.append(
            f'  <line x1="{x1:.1f}" y1="{y1:.1f}" x2="{x2:.1f}" y2="{y2:.1f}"'
            f' stroke="{hour_colour(hour)}" stroke-width="3.2" stroke-linecap="round">'
            f'<animate attributeName="x2" values="{x1:.1f};{x1:.1f};{x2:.1f}"'
            f' keyTimes="0;{round(delay / dur, 3)};1" dur="{dur}s" begin="0s" fill="freeze"'
            f' calcMode="spline" keySplines="0 0 1 1;0.3 0 0.2 1"/>'
            f'<animate attributeName="y2" values="{y1:.1f};{y1:.1f};{y2:.1f}"'
            f' keyTimes="0;{round(delay / dur, 3)};1" dur="{dur}s" begin="0s" fill="freeze"'
            f' calcMode="spline" keySplines="0 0 1 1;0.3 0 0.2 1"/></line>'
        )

    # sweep hand — one revolution is one day
    out += [
        f'  <g transform="rotate(0 {cx} {cy})">',
        f'    <animateTransform attributeName="transform" type="rotate"'
        f' values="0 {cx} {cy};360 {cx} {cy}" dur="16s" repeatCount="indefinite"/>',
        f'    <line x1="{cx}" y1="{cy}" x2="{cx}" y2="{cy - rim:.1f}"'
        f' stroke="{marina.TEAL}" stroke-width="1" opacity="0.3"/>',
        "  </g>",
        f'  <circle cx="{cx}" cy="{cy}" r="2.5" fill="{marina.TEAL}" opacity="0.7"/>',
    ]

    for hour, label in ((0, "00"), (6, "06"), (12, "12"), (18, "18")):
        angle = math.radians(-90 + hour * 15)
        tx, ty = cx + (rim + 11) * math.cos(angle), cy + (rim + 11) * math.sin(angle)
        out.append(
            f'  <text x="{tx:.1f}" y="{ty + 3:.1f}" class="tick" text-anchor="middle">{label}</text>'
        )

    return out


# ── the sun / moon arc ────────────────────────────────────────────────────────

# ── the streak band ───────────────────────────────────────────────────────────

def _band(y: float, by_hour: list[int], streak) -> list[str]:
    """The clock and the streak figures on one line.

    They were stacked, which cost ~110px of height to say two things that are
    both "activity". Four cells: the dial keeps its own, the three figures split
    what is left.
    """
    dial_w = 160
    rest   = (RIGHT - (LEFT + dial_w)) / 3
    cols   = [LEFT + dial_w + rest * (i + 0.5) for i in range(3)]

    out = ["", "  <!-- when I commit, and how long the streaks run -->"]
    out += _dial(LEFT + dial_w / 2, y + 68, by_hour)
    out.append(
        f'  <text x="{LEFT + dial_w / 2}" y="{y + 148}" class="cap"'
        ' text-anchor="middle">commits by hour</text>'
    )

    if not streak:
        return out

    total, span_all, best, span_best, current, span_cur = streak
    ring = 24
    circ = 2 * math.pi * ring
    lead = circ * 0.75 - 15
    cy   = y + 54

    def figure(cx, value, label, sub):
        return [
            f'  <text x="{cx:.1f}" y="{y + 60}" class="fig" text-anchor="middle">{value}</text>',
            f'  <text x="{cx:.1f}" y="{y + 92}" class="figl" text-anchor="middle">{label}</text>',
            f'  <text x="{cx:.1f}" y="{y + 108}" class="figs" text-anchor="middle">{sub}</text>',
        ]

    def short(d):
        return f"{d:%b} {d.day}"

    out += figure(cols[0], f"{total:,}", "Total Contributions",
                  f"{span_all[0]:%b} {span_all[0].day}, {span_all[0].year} — Present")

    out += [
        f'  <circle cx="{cols[1]:.1f}" cy="{cy}" r="{ring}" fill="none"'
        f' stroke="{marina.TRACK}" stroke-width="3.5"/>',
        f'  <circle cx="{cols[1]:.1f}" cy="{cy}" r="{ring}" fill="none"'
        f' stroke="{marina.CYAN}" stroke-width="3.5" stroke-linecap="round"'
        f' stroke-dasharray="{lead:.1f} 30 {circ - lead - 30:.1f} 0"/>',
        f'  <text x="{cols[1]:.1f}" y="{cy + 8}" class="ring" text-anchor="middle">{current}</text>',
        f'  <g transform="translate({cols[1]:.1f},{cy - ring})">',
        f'    <path d="{FLAME}" fill="{marina.TEAL}"/>',
        f'    <path d="{FLAME}" fill="{marina.CYAN}" transform="scale(0.5)"/>',
        "  </g>",
        f'  <text x="{cols[1]:.1f}" y="{y + 92}" class="figl" text-anchor="middle"'
        f' style="fill:{marina.CYAN}">Current Streak</text>',
    ]
    if span_cur:
        out.append(
            f'  <text x="{cols[1]:.1f}" y="{y + 108}" class="figs" text-anchor="middle">'
            f'{short(span_cur[1])}</text>'
        )

    out += figure(cols[2], str(best), "Longest Streak",
                  f"{short(span_best[0])} — {short(span_best[1])}")

    for i in range(3):
        x = LEFT + dial_w + rest * i
        out.append(
            f'  <rect x="{x:.1f}" y="{y + 24}" width="1" height="{BAND_H - 72}"'
            f' fill="{marina.RULE}" opacity="0.7"/>'
        )
    return out


# ── the card ──────────────────────────────────────────────────────────────────

def _prompt(y: float) -> list[str]:
    """The prompt that would follow real fetch output. Shared with
    assets/dividers/divider-terminal.svg via svgkit, because it has to be
    inlined — an SVG behind camo renders in an <img>, where <use href> to
    another file is blocked."""
    texts, rule_x = svgkit.prompt_run(LEFT, y, cls="pr")
    out = ["", "  <!-- the prompt you'd be looking at after the fetch -->"]
    out += [f"  {line}" for line in texts]
    out.append(
        f'  <rect x="{rule_x:g}" y="{y - 5}" width="{RIGHT - 14 - rule_x:g}" height="1.2"'
        f' rx="0.6" fill="url(#promptFade)"/>'
    )
    out += [f"  {line}" for line in svgkit.cursor(RIGHT - 8, y - 10)]
    return out


def _svg(rows, by_hour: list[int], streak, pic: str) -> str:
    ys, seps = [], []
    y = BODY_Y
    for key, _ in rows:
        if not key:
            seps.append(y + GAP_STEP / 2)
            y += GAP_STEP
            ys.append(None)
            continue
        y += ROW_STEP
        ys.append(y)
    rows_end = y

    body_end = max(rows_end, BODY_Y + LOGO_SIZE)
    band_y   = body_end + 30
    strip_y  = band_y + BAND_H + 16
    prompt_y = strip_y + 8 + 30
    h        = prompt_y + 30

    aria = "; ".join(f"{k}: {v}" for k, v in rows if k)

    out = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{h}" viewBox="0 0 {W} {h}"',
        f'     role="img" aria-label="{esc(aria)}">',
        "  <defs>",
        # divider.svg's treatment, so the card's rules read as the same object
        '    <linearGradient id="headRule" x1="0" y1="0" x2="1" y2="0">',
        f'      <stop offset="0%"   stop-color="{marina.CYAN}" stop-opacity="0.95"/>',
        f'      <stop offset="55%"  stop-color="{marina.TEAL}" stop-opacity="0.55"/>',
        f'      <stop offset="100%" stop-color="{marina.TEAL}" stop-opacity="0"/>',
        "    </linearGradient>",
        *[f"    {line}" for line in svgkit.prompt_fade()],
        '    <linearGradient id="sepRule" x1="0" y1="0" x2="1" y2="0">',
        f'      <stop offset="0%"   stop-color="{marina.CYAN}" stop-opacity="0"/>',
        f'      <stop offset="50%"  stop-color="{marina.CYAN}" stop-opacity="0.26"/>',
        f'      <stop offset="100%" stop-color="{marina.CYAN}" stop-opacity="0"/>',
        "    </linearGradient>",
        *[f"    {line}" for line in svgkit.sweep_gradient()],
        "    <style>",
        f"      .k    {{ font: 600 14px {marina.FONT}; fill: {marina.HEADING}; }}",
        f"      .v    {{ font: 400 14px {marina.FONT}; fill: {marina.INK}; }}",
        f"      .u    {{ font: 700 16px {marina.FONT}; fill: {marina.TEAL}; }}",
        f"      .d    {{ font: 700 16px {marina.FONT}; fill: {marina.INK_MUTED}; }}",
        f"      .tick {{ font: 500 9px {marina.FONT}; fill: {marina.INK_MUTED}; }}",
        f"      .cap  {{ font: 500 10px {marina.FONT}; fill: {marina.INK_MUTED}; }}",
        f"      .pr   {{ font: 500 12px {marina.FONT}; }}",
        f"      .fig  {{ font: 700 21px {marina.FONT}; fill: {marina.CYAN}; }}",
        f"      .figl {{ font: 600 11px {marina.FONT}; fill: {marina.INK}; }}",
        f"      .figs {{ font: 500 10px {marina.FONT}; fill: {marina.INK_MUTED}; }}",
        f"      .ring {{ font: 700 18px {marina.FONT}; fill: {marina.INK}; }}",
        "    </style>",
        f'    <clipPath id="headClip">'
        f'<rect x="{TEXT_X}" y="{HEAD_Y + 12}" width="{RIGHT - TEXT_X}" height="2"/></clipPath>',
        "  </defs>",
        "",
        f'  <rect width="{W}" height="{h}" fill="{marina.SURFACE}" rx="10"'
        f' stroke="{marina.RULE}" stroke-width="1"/>',
    ]

    # left column: logo, and the dial beneath it when that style is on
    # top-aligned with the title rather than centred: fastfetch starts its art
    # at the first line, and centring left a dead band above the logo
    left_top = HEAD_Y - 14
    out += _logo(LEFT, left_top, LOGO_SIZE, pic)

    out += [
        "",
        f'  <text x="{TEXT_X}" y="{HEAD_Y}"><tspan class="u">{esc(USERNAME.lower())}</tspan>'
        f'<tspan class="d">@</tspan><tspan class="u">github</tspan></text>',
        f'  <rect x="{TEXT_X}" y="{HEAD_Y + 12}" width="{RIGHT - TEXT_X}" height="2" rx="1"'
        f' fill="url(#headRule)"/>',
        '  <g clip-path="url(#headClip)">',
        f'    <rect x="{TEXT_X}" y="{HEAD_Y + 12}" width="110" height="2" rx="1" fill="url(#sweep)">',
        f'      <animate attributeName="x" from="{TEXT_X - 110}" to="{RIGHT}"'
        ' dur="3.6s" repeatCount="indefinite"/>',
        "    </rect>",
        "  </g>",
        f'  <circle cx="{(TEXT_X + RIGHT) / 2}" cy="{HEAD_Y + 13}" r="2.5" fill="{marina.TEAL}">',
        '    <animate attributeName="opacity" values="0.3;1;0.3" dur="2.2s" repeatCount="indefinite"/>',
        "  </circle>",
    ]

    for i, (key, val) in enumerate(rows):
        if not key:
            continue
        delay = round(0.035 * i, 3)
        dur   = round(delay + 0.4, 3)
        out += [
            "",
            '  <g opacity="1">',
            f'    <animate attributeName="opacity" values="0;0;1"'
            f' keyTimes="0;{round(delay / dur, 3)};1" dur="{dur}s" begin="0s" fill="freeze"/>',
            f'    <text x="{TEXT_X}" y="{ys[i]}" class="k">{esc(key)}</text>',
            f'    <text x="{VAL_X}" y="{ys[i]}" class="v">{esc(val)}</text>',
            "  </g>",
        ]

    out.append("")
    for i, sy in enumerate(seps):
        out.append(
            f'  <rect x="{TEXT_X}" y="{sy:.1f}" width="{RIGHT - TEXT_X}" height="1"'
            f' fill="url(#sepRule)"/>'
        )

    out.append(
        f'\n  <rect x="{LEFT}" y="{band_y - 16:.1f}" width="{RIGHT - LEFT}" height="1"'
        f' fill="url(#sepRule)"/>'
    )
    out += _band(band_y, by_hour, streak)

    # palette strip, spanning exactly the content width
    strip = RIGHT - LEFT
    seg   = (strip - 6 * (len(marina.ACCENTS) - 1)) / len(marina.ACCENTS)
    out.append("")
    for i, colour in enumerate(marina.ACCENTS):
        x = LEFT + i * (seg + 6)
        out.append(
            f'  <rect x="{x:.1f}" y="{strip_y:.1f}" width="{seg:.1f}" height="8" rx="4"'
            f' fill="{colour}"/>'
        )

    out += _prompt(prompt_y)

    out.append("</svg>")
    return "\n".join(out) + "\n"


def main():
    print(f"Scanning {USERNAME}'s repos (last {DAYS_BACK} days)…", file=sys.stderr)
    hours = commit_hours()
    if not hours:
        print("No commits found — aborting to avoid overwriting with empty data.", file=sys.stderr)
        sys.exit(1)

    by_hour = [0] * 24
    for hour in hours:
        by_hour[hour] += 1

    streak = contributions()
    rows, pic = collect(len(hours))

    print()
    for key, val in rows:
        print(f"  {key:<10} {val}" if key else "")
    print(f"  peak hour  {by_hour.index(max(by_hour)):02d}:00 ({max(by_hour)} commits)")
    if streak:
        print(f"  streaks    {streak[0]:,} total · {streak[4]} current · {streak[2]} longest")

    # render before opening the file: "w" truncates, so building the SVG inside
    # the with-block leaves a 0-byte asset behind if anything raises
    svg      = _svg(rows, by_hour, streak, pic)
    out_path = os.path.normpath(OUTPUT)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(svg)
    print(f"\nWritten → {out_path}", file=sys.stderr)


if __name__ == "__main__":
    main()
