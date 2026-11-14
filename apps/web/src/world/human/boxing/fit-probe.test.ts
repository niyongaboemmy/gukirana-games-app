import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import { loadBodyNode } from "./load-glb.dev";
import { dressBody } from "./kit-mesh";
import { boxingKitOverride } from "./kit";
import { BoxingRig } from "./rig";
import { DEFAULT_LOOK } from "../../outfits";

const asset = (n: string) => fileURLToPath(new URL(`../../../../public/assets/characters/${n}.glb`, import.meta.url));

describe("ring kit fits the real Rocketbox bodies", () => {
  it.each(["masculine", "feminine", "neutral"] as const)("%s: trunks on the hips, boots at the ankles, headgear on the head", async (b) => {
    const root = await loadBodyNode(asset(b));
    root.updateMatrixWorld(true);
    const rig = new BoxingRig(root, []);
    expect(rig.measured.hipY).toBeGreaterThan(0.85);
    expect(rig.measured.hipY).toBeLessThan(0.95);
    const d = dressBody(root, [], [], b, boxingKitOverride(DEFAULT_LOOK, "blue", { headgear: true }), false);
    root.updateMatrixWorld(true);
    const box = (name: string) => {
      const o = d.objects.find((x) => x.name === name)!;
      return new THREE.Box3().setFromObject(o);
    };
    const trunks = box("gk-trunks");
    expect(trunks.min.y).toBeGreaterThan(rig.measured.hipY - 0.45);
    expect(trunks.max.y).toBeLessThan(rig.measured.hipY + 0.25);
    expect(trunks.getSize(new THREE.Vector3()).x).toBeLessThan(0.6);
    const boots = box("gk-boots");
    expect(boots.max.y).toBeLessThan(0.4);
    const head = root.getObjectByName("Bip01_Head")!.getWorldPosition(new THREE.Vector3());
    const pads = box("gk-headgear");
    expect(pads.getCenter(new THREE.Vector3()).distanceTo(head)).toBeLessThan(0.15);
    d.dispose();
    expect(root.getObjectByName("gk-trunks")).toBeUndefined();
  });
});
