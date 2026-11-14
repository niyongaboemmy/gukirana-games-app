import type { AvatarLook, HairStyle } from "../../outfits";

/**
 * Boxing kit (P3-FGT-02): the temporary outfit a player wears in the ring, in their corner's colour:
 *  - a vest in the corner colour (amateur style, every body type), satin trunks with a wide waistband and a side
 *    stripe, high-top laced boots, leather lace-up gloves with a wrist strap and a cuff in the corner colour;
 *  - optional padded headgear (open face, cheek and ear pads, chin strap; the hair is compressed under it) and a
 *    mouthguard (seen when the lips part).
 * `boxingKitOverride` returns a NEW look (the saved look is never touched) plus the kit spec the rig layer dresses the
 * body with (kit-mesh.ts); `KitSwap` is the fade-out → swap → fade-in timing for ring entry / exit.
 */

export type Corner = "red" | "blue";

export interface BoxingKitOptions {
  /** padded headgear (amateur bouts, sparring) */
  headgear?: boolean;
  /** mouthguard (visible when the lips part) */
  mouthguard?: boolean;
  /** boots colour: "black" (default), "white" or the corner colour */
  boots?: "black" | "white" | "corner";
}

/** Corner colours: deep, matte sport red / blue (no neon), with a lighter trim tone and a dark tone for shading. */
export const CORNER_COLORS: Record<Corner, { main: string; trim: string; dark: string; lamp: string }> = {
  red: { main: "#b3242b", trim: "#e8e4dc", dark: "#5e1216", lamp: "#ff4a4a" },
  blue: { main: "#1f4fb0", trim: "#e8e4dc", dark: "#0f2558", lamp: "#4a8bff" },
};

export interface BoxingKit {
  corner: Corner;
  /** the look to render while in the ring (a copy; the saved look is unchanged) */
  look: AvatarLook;
  headgear: boolean;
  mouthguard: boolean;
  colors: {
    vest: string;
    trunks: string;
    waistband: string;
    stripe: string;
    gloves: string;
    gloveTrim: string;
    laces: string;
    boots: string;
    bootTrim: string;
    headgear: string;
    mouthguard: string;
  };
}

/** styles that don't go under headgear / into the ring as they are */
const RING_HAIR: Partial<Record<HairStyle, HairStyle>> = {
  headwrap: "bun",
};

export function boxingKitOverride(look: AvatarLook, corner: Corner, opts: BoxingKitOptions = {}): BoxingKit {
  const c = CORNER_COLORS[corner];
  const headgear = !!opts.headgear;
  const boots = opts.boots === "white" ? "#e9e6df" : opts.boots === "corner" ? c.main : "#1b1b1d";
  const kit: BoxingKit = {
    corner,
    headgear,
    mouthguard: opts.mouthguard ?? true,
    colors: {
      vest: c.main,
      trunks: c.main,
      waistband: c.dark,
      stripe: c.trim,
      gloves: c.main,
      gloveTrim: c.trim,
      laces: c.trim,
      boots,
      bootTrim: opts.boots === "white" ? c.main : c.trim,
      headgear: c.main,
      mouthguard: corner === "red" ? "#c43a3a" : "#3a63c4",
    },
    look: {
      ...look,
      hairStyle: RING_HAIR[look.hairStyle] ?? look.hairStyle,
      // a fresh outfit object: the saved look's outfit is never shared or mutated
      outfit: {
        top: "tee",
        bottom: "shorts",
        shoes: "sneakers",
        accessory: "none",
        // the fitted beanie shell is the headgear's crown (hair compressed under it); kit-mesh.ts re-skins it
        headwear: headgear ? "beanie" : "no-hat",
      },
      topColor: c.main,
      face: { ...look.face },
    },
  };
  return kit;
}

/** The referee's look on any body (staff NPC): white shirt, dark trousers, black shoes; no accessories. */
export function refereeLook(look: AvatarLook): AvatarLook {
  return {
    ...look,
    hairStyle: RING_HAIR[look.hairStyle] ?? look.hairStyle,
    outfit: { top: "tee-white", bottom: "jeans", shoes: "loafers", accessory: "none", headwear: "no-hat" },
    topColor: undefined,
    face: { ...look.face },
  };
}

/**
 * Ring entry / exit swap timing: fade out (dithered, the Avatar's fadeRef), swap the look at the darkest point, fade
 * back in "dressed". Pure: sample(t) for any clock time.
 *
 *   const swap = new KitSwap();          swap.enter(now)  /  swap.exit(now)
 *   const s = swap.sample(now);          fadeRef.current = s.fade;  look = s.wearing ? kit.look : saved;
 */
export class KitSwap {
  /** fade-out and fade-in times (s) */
  constructor(
    readonly out = 0.22,
    readonly back = 0.3,
  ) {}
  private at = -Infinity;
  private to = false;
  private from = false;

  enter(t: number) {
    this.begin(t, true);
  }
  exit(t: number) {
    this.begin(t, false);
  }
  private begin(t: number, to: boolean) {
    const cur = this.sample(t).wearing;
    if (to === this.to && t - this.at < this.out + this.back) return;
    this.from = cur;
    this.to = to;
    this.at = t;
  }

  /** fade: 1 visible … 0 hidden; wearing: the kit look is the one to render now; busy: a swap is running */
  sample(t: number): { fade: number; wearing: boolean; busy: boolean } {
    const d = t - this.at;
    if (!(d >= 0) || d >= this.out + this.back) return { fade: 1, wearing: this.to, busy: false };
    if (this.from === this.to) return { fade: 1, wearing: this.to, busy: false };
    if (d < this.out) {
      const x = d / this.out;
      return { fade: 1 - x * x * (3 - 2 * x), wearing: this.from, busy: true };
    }
    const x = (d - this.out) / this.back;
    return { fade: x * x * (3 - 2 * x), wearing: this.to, busy: true };
  }
}
