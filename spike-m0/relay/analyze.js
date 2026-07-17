// Post-drive continuity report for the NDJSON log the relay writes.
// Usage: node analyze.js [positions.ndjson] [gap-threshold-seconds]
//
// Prints: update count, span, largest gap, and every gap over the threshold
// (default 60 s — matches the spec's staleness metric).

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const file = process.argv[2] || path.join(__dirname, "positions.ndjson");
const gapThresholdMs = (Number(process.argv[3]) || 60) * 1000;

const lines = readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
const rows = lines.map((l) => JSON.parse(l)).sort((a, b) => a.ts - b.ts);

if (rows.length === 0) {
  console.log("no positions in file");
  process.exit(0);
}

const first = rows[0];
const last = rows[rows.length - 1];
const spanMs = last.ts - first.ts;

let maxGapMs = 0;
const gaps = [];
for (let i = 1; i < rows.length; i++) {
  const gap = rows[i].ts - rows[i - 1].ts;
  if (gap > maxGapMs) maxGapMs = gap;
  if (gap > gapThresholdMs) {
    gaps.push({ at: new Date(rows[i - 1].ts).toISOString(), gapS: Math.round(gap / 1000) });
  }
}

const fmt = (ms) => `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`;

console.log(`file:          ${file}`);
console.log(`updates:       ${rows.length}`);
console.log(`span:          ${fmt(spanMs)} (${new Date(first.ts).toISOString()} -> ${new Date(last.ts).toISOString()})`);
console.log(`avg interval:  ${rows.length > 1 ? Math.round(spanMs / (rows.length - 1) / 1000) : "-"}s`);
console.log(`largest gap:   ${fmt(maxGapMs)}`);
console.log(`gaps > ${gapThresholdMs / 1000}s:    ${gaps.length}`);
for (const g of gaps) console.log(`  - ${g.gapS}s starting ${g.at}`);
console.log(
  gaps.length === 0
    ? "PASS: no staleness gaps over threshold"
    : "REVIEW: gaps above threshold — correlate with screen-lock / OEM battery events"
);
