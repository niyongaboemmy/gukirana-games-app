// P3-FGT-19A: print the anthropometric audit of the four v8 prototype bodies (bind pose).
//   MH_DIR=<makehuman checkout>/makehuman/data node qa/fighter-v8/measure.mjs
import { buildBody, FIGHTERS, loadMH } from "./lib/body.mjs";

const mh = loadMH(process.env.MH_DIR);
for (const [k, s] of Object.entries(FIGHTERS)) {
  const b = buildBody(mh, s);
  console.log(k, JSON.stringify(b.measure));
}
