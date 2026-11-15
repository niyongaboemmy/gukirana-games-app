import { campusWalkRoute, type P } from "./campus";
import { planRoute } from "./obstacles";
import type { Destination } from "./destinations";

/** Click-to-walk over the campus walks: the network's waypoints, the plaza crossings routed round the furniture. */
export function walkRoute(from: P, to: P): P[] {
  const out: P[] = [];
  let at = from;
  for (const w of campusWalkRoute(from, to)) {
    if (w.plaza) out.push(...planRoute(at, { x: w.x, z: w.z }));
    else out.push({ x: w.x, z: w.z });
    at = w;
  }
  return out;
}

/**
 * Go To "Walk there" (P2-WLD-13): the player's waypoints to a destination — over the walks and round the plaza
 * furniture to its stop (a hall's doorstep), then on through the door when it opens for you (crossing the door line
 * enters the hall, like walking in by hand). A shut door: the walk ends at the doorstep, where its notice explains.
 */
export function walkPlan(from: P, d: Destination, doorOpen: boolean): P[] {
  const out = walkRoute(from, d.stop);
  if (doorOpen && d.through) out.push(d.through);
  return out;
}
