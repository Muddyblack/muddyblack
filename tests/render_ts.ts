// Render the card from tests/fixture.json using the Worker's renderer.
import { readFileSync } from "node:fs";
import { render } from "./card.ts";
import type { Streaks } from "./github.ts";

const fx = JSON.parse(readFileSync(new URL("./fixture.json", import.meta.url), "utf8"));
process.stdout.write(
  render(fx.rows as [string, string][], fx.byHour as number[], fx.streak as Streaks,
         fx.pic as string, fx.login as string, fx.tzLabel as string),
);
