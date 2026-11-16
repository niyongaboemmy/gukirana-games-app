// P3-FGT-19A (dev only): the arm-visibility check (fifth user review). For each fighter / pose / camera the page
// ray-tests every camera-facing upper-arm vertex: the outer upper arm must be skin, never singlet cloth.
//   node qa/fighter-v8/armtest.mjs [mW,fL]   → raw/armtest.json + a table on stdout (exit 1 if any case fails)
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const fighters = (process.argv[2] ?? "mW,fL").split(",");
const shots = [];
for (const f of fighters)
  for (const pose of ["guard", "jab", "hook"])
    for (const [cam, az] of [["front", 0], ["broadcast-lead", 90], ["broadcast-rear", -90], ["34", 40]])
      shots.push([`arm-${f}-${pose}-${cam}`, `f=${f}&pose=${pose}&az=${az}&el=3&dist=2.6&fov=26&ty=1.2&w=400&h=500&pt=0&armtest=1`]);
writeFileSync(join(HERE, "raw", "armtest-shots.json"), JSON.stringify(shots));
execFileSync("node", [join(HERE, "shoot.mjs"), join(HERE, "raw", "armtest-shots.json")], { stdio: "ignore" });
const logs = readdirSync(join(HERE, "raw")).filter((f) => f.startsWith("log-")).sort();
const last = JSON.parse(readFileSync(join(HERE, "raw", logs[logs.length - 1]), "utf8"));
const rows = last.filter((e) => e.name.startsWith("arm-")).map((e) => ({ case: e.name.slice(4), ...e.info.armTest }));
let fail = 0;
for (const r of rows) {
  const ok = r.coveredFraction <= 0.02;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${r.case.padEnd(28)} tested ${String(r.tested).padStart(5)} covered by singlet ${(r.coveredFraction * 100).toFixed(1)} %`);
}
writeFileSync(join(HERE, "raw", "armtest.json"), JSON.stringify(rows, null, 1));
process.exit(fail ? 1 : 0);
