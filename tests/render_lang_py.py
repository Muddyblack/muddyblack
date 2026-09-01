#!/usr/bin/env python3
"""Render the language treemap from tests/lang_fixture.json, Python side."""

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(HERE, "..", "scripts"))

import generate_lang_treemap as g  # noqa: E402

fx = json.load(open(os.path.join(HERE, "lang_fixture.json"), encoding="utf-8"))
ranked = [(lang, value) for lang, value in fx["ranked"]]
tiles, tail = g.fold(ranked)

sys.stdout.write(g.render(tiles, tail, fx["commits"], fx["repos"]))
