// Render the language treemap from tests/lang_fixture.json using the Worker's renderer.
import { readFileSync } from "node:fs";
import { fold, render, type Tile } from "./languages.ts";

const fx = JSON.parse(readFileSync(new URL("./lang_fixture.json", import.meta.url), "utf8"));
const { tiles, tail } = fold(fx.ranked as Tile[]);
process.stdout.write(render(tiles, tail, fx.commits as number, fx.repos as number));
