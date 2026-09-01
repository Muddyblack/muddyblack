// A single cold call measures V8 compiling the renderer, not the renderer.
// Workers reuses a warm isolate across requests, so steady state is what the
// 10ms CPU limit actually applies to.
import { readFileSync } from "node:fs";
import { render } from "./card.ts";
import type { Streaks } from "./github.ts";

const fx = JSON.parse(readFileSync(new URL("../../tests/fixture.json", import.meta.url), "utf8"));
// a realistic avatar payload: base64 of 48KB, as the live one now is
const pic = "data:image/png;base64," + "A".repeat(64 * 1024);

const call = () => render(fx.rows, fx.byHour, fx.streak as Streaks, pic, fx.login, fx.tzLabel);

for (let i = 0; i < 50; i++) call();            // warm up

const samples: number[] = [];
for (let i = 0; i < 200; i++) {
  const t0 = process.hrtime.bigint();
  call();
  samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
}
samples.sort((a, b) => a - b);
const at = (p: number) => samples[Math.floor(samples.length * p)].toFixed(2);
console.log(`  render, warm isolate   p50 ${at(0.5)} ms · p95 ${at(0.95)} ms · max ${samples[samples.length - 1].toFixed(2)} ms`);
console.log(`  free plan CPU budget   10 ms`);
