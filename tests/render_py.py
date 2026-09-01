#!/usr/bin/env python3
"""Render the card from tests/fixture.json using the Python generator."""

import json
import os
import sys
from datetime import date

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import generate_fastfetch as g  # noqa: E402

fx = json.load(open(os.path.join(HERE, "fixture.json"), encoding="utf-8"))
s  = fx["streak"]
day = date.fromisoformat

streak = (
    s["total"],
    (day(s["first"]), day(s["currentEnd"])),
    s["best"],
    (day(s["bestSpan"][0]), day(s["bestSpan"][1])),
    s["current"],
    (day(s["currentEnd"]), day(s["currentEnd"])),
)
rows = [tuple(r) for r in fx["rows"]]

sys.stdout.write(g._svg(rows, fx["byHour"], streak, fx["pic"]))
