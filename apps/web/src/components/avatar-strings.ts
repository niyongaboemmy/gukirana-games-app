import type { BrowStyle, Expression, EyeShape, FaceShape, FacialHair, LipShape, Makeup, NoseShape, SkinMark } from "@/world/face";
import type { AgeGroup } from "@/world/age";

/**
 * Avatar editor strings, English catalogue (i18n-ready like admin-block/strings.ts; to move to @gukirana/i18n keys
 * `avatar.*` when the catalogue is localised).
 */
export const AVATAR = {
  title: "Style your avatar",
  loadingPreview: "Loading preview…",
  bodyNote: "You choose your body style. We never guess it from your name or number.",
  showAll: "Show all items",
  suggested: "Suggested",
  save: "Save look",
  cancel: "Cancel",
  wave: "Wave",
  accent: "Accent colour",
  hairColour: "Hair colour",
  headwear: "Headwear",
  accessory: "Accessory",
  sections: "Avatar sections",
  colour: "Colour",
  zoomFace: "Close-up",
  zoomBody: "Full body",
  age: {
    title: "Age",
    note: "Adults only: everyone here is 18 or older.",
    options: { young: "Young adult (18–30)", adult: "Adult (31–50)", senior: "Senior (50+)" } satisfies Record<AgeGroup, string>,
  },
  tabs: { body: "Body", face: "Face", skin: "Skin", hair: "Hair", top: "Top", bottom: "Bottom", shoes: "Shoes", extras: "Extras" },
  face: {
    note: "Shape your face. Everyone else sees the same face.",
    shape: "Face shape",
    expression: "Expression",
    eyes: "Eyes",
    eyeColour: "Eye colour",
    brows: "Eyebrows",
    nose: "Nose",
    lips: "Lips",
    facialHair: "Facial hair",
    facialHairNote: "Takes your hair colour.",
    marks: "Freckles and marks",
    makeup: "Make-up",
    makeupNote: "Optional and subtle.",
    glassesNote: "Glasses and sunglasses are under Extras.",
  },
} as const;

export const FACE_LABELS: {
  shape: Record<FaceShape, string>;
  eyes: Record<EyeShape, string>;
  brows: Record<BrowStyle, string>;
  nose: Record<NoseShape, string>;
  lips: Record<LipShape, string>;
  facialHair: Record<FacialHair, string>;
  marks: Record<SkinMark, string>;
  makeup: Record<Makeup, string>;
  expression: Record<Expression, string>;
} = {
  shape: { oval: "Oval", round: "Round", square: "Square", heart: "Heart", long: "Long" },
  eyes: { almond: "Almond", round: "Round", hooded: "Hooded", narrow: "Narrow", deep: "Deep-set" },
  brows: { natural: "Natural", full: "Full", arched: "Arched", straight: "Straight", thin: "Thin", bold: "Bold" },
  nose: { broad: "Broad", rounded: "Rounded", straight: "Straight", narrow: "Narrow", wide: "Wide, low bridge" },
  lips: { full: "Full", medium: "Medium", thin: "Thin", wide: "Wide", bow: "Cupid's bow" },
  facialHair: {
    none: "Clean-shaven",
    stubble: "Stubble",
    moustache: "Moustache",
    goatee: "Goatee",
    chinstrap: "Chin strap",
    short: "Short beard",
    full: "Full beard",
    shadow: "Moustache and stubble",
  },
  marks: { none: "None", lightFreckles: "Light freckles", freckles: "Freckles", markCheek: "Beauty mark (cheek)", markLip: "Beauty mark (lip)", markChin: "Beauty mark (chin)" },
  expression: { relaxed: "Relaxed", smile: "Smile", serious: "Serious" },
  makeup: { none: "None", gloss: "Lip gloss", berry: "Berry lips", red: "Warm red lips", liner: "Eyeliner", linerBerry: "Eyeliner and berry lips" },
};

export const EYE_COLOUR_LABELS = ["Deep brown", "Dark brown", "Brown", "Warm brown", "Amber", "Grey brown", "Hazel"] as const;
