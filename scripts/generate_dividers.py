#!/usr/bin/env python3
"""Rewrite the two dividers that share markup with the fastfetch card.

The bespoke dividers in assets/dividers/ (fiber, packet, pcb, scope, commit,
label) are hand-authored and deliberately left alone — this only regenerates the
two whose markup the card also draws, so a palette change lands everywhere.
"""

import os

import svgkit

HERE = os.path.dirname(__file__)

TARGETS = {
    "../assets/divider.svg":                     svgkit.divider_svg,
    "../assets/dividers/divider-terminal.svg":   svgkit.terminal_divider_svg,
}


def main():
    for rel, build in TARGETS.items():
        path = os.path.normpath(os.path.join(HERE, rel))
        with open(path, "w", encoding="utf-8") as f:
            f.write(build())
        print(f"Written → {path}")


if __name__ == "__main__":
    main()
