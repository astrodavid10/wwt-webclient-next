// Fails the build if debug artifacts or oversized files would be deployed
// (audit E4). Run after `yarn build`: `yarn check:dist`.
import fs from "node:fs";
import path from "node:path";

const DIST = "dist";
// Total budget for what we ship (excluding nothing: WWT's own assets load
// from its CDN, not from dist). Raise deliberately if the app grows.
const BUDGET_BYTES = 6 * 1024 * 1024;

const bad = [];
let total = 0;
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { walk(p); continue; }
    total += fs.statSync(p).size;
    if (p.endsWith(".map") || p.endsWith(".tsbuildinfo")) { bad.push(p); }
  }
};
walk(DIST);

const mb = (n) => (n / 1024 / 1024).toFixed(2) + " MB";
console.log(`dist total: ${mb(total)} (budget ${mb(BUDGET_BYTES)})`);
if (bad.length) {
  console.error("Debug artifacts in dist:\n  " + bad.join("\n  "));
  process.exit(1);
}
if (total > BUDGET_BYTES) {
  console.error("dist is over budget");
  process.exit(1);
}
