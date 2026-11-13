"use client";
import { ACT, type PairKind } from "@gukirana/contracts";
import { Brain, Camera, CircleCheck, CircleHelp, CircleX, Coffee, Frown, Hand, HandFist, Handshake, HeartHandshake, Laugh, Music, PartyPopper, Pointer, Smartphone, Sparkles, ThumbsUp, type LucideIcon } from "lucide-react";

/**
 * People actions catalogue (P1-WLD-02 / P1-COM-04, docs/PEOPLE-BEHAVIOUR.md): what a player can do with their
 * avatar, how long it lasts and how it is offered. The anim codes are shared with the server (packages/contracts
 * ACT) so everyone sees the same action. UI strings are keyed for @gukirana/i18n (`people.*`); English below.
 */
export interface ActionDef {
  id: number;
  /** i18n key */
  key: string;
  label: string;
  icon: LucideIcon;
  /** how long the action plays (ms); 0 = holds until you walk (coffee, leaning, watching) */
  ms: number;
  /** turn to face the person you aim it at (or the nearest one within 4 m) first */
  face?: boolean;
}

const A = (id: number, key: string, label: string, icon: LucideIcon, ms: number, face = false): ActionDef => ({ id, key: `people.action.${key}`, label, icon, ms, face });

export const ACTIONS: Record<string, ActionDef> = {
  wave: A(ACT.wave, "wave", "Wave", Hand, 2600, true),
  nod: A(ACT.nod, "nod", "Nod", CircleCheck, 2300, true),
  shakeHead: A(ACT.shakeHead, "shakeHead", "Shake head", CircleX, 2600, true),
  thumbsUp: A(ACT.thumbsUp, "thumbsUp", "Thumbs up", ThumbsUp, 2200, true),
  clap: A(ACT.clap, "clap", "Clap", PartyPopper, 3200, true),
  laugh: A(ACT.laugh, "laugh", "Laugh", Laugh, 4300, true),
  point: A(ACT.point, "point", "Point", Pointer, 2400, true),
  shrug: A(ACT.shrug, "shrug", "Shrug", CircleHelp, 1900, true),
  cheer: A(ACT.cheer, "cheer", "Celebrate", Sparkles, 3600),
  dance: A(ACT.dance, "dance", "Dance", Music, 8000),
  think: A(ACT.think, "think", "Think", Brain, 8500),
  disappointed: A(ACT.disappointed, "disappointed", "Oh no", Frown, 2800),
  phone: A(ACT.phone, "phone", "Check phone", Smartphone, 6300),
  photo: A(ACT.photo, "photo", "Take a photo", Camera, 8200),
  coffee: A(ACT.coffee, "coffee", "Coffee", Coffee, 0),
  lean: A(ACT.lean, "lean", "Lean here", Hand, 0),
  watch: A(ACT.watch, "watch", "Watch", Hand, 0),
  chalk: A(ACT.chalk, "chalk", "Chalk cue", Hand, 4200),
};

/** The emote picker (HUD): everyday gestures first. */
export const EMOTE_PICKER: ActionDef[] = [
  ACTIONS.wave!,
  ACTIONS.nod!,
  ACTIONS.thumbsUp!,
  ACTIONS.clap!,
  ACTIONS.laugh!,
  ACTIONS.point!,
  ACTIONS.shrug!,
  ACTIONS.shakeHead!,
  ACTIONS.cheer!,
  ACTIONS.photo!,
  ACTIONS.phone!,
  ACTIONS.dance!,
];

export const actionById = (id: number): ActionDef | undefined => Object.values(ACTIONS).find((a) => a.id === id);

/** Contact actions (need the other person to accept). */
export const PAIR_ACTIONS: { kind: PairKind; key: string; label: string; icon: LucideIcon; verb: string }[] = [
  { kind: "handshake", key: "people.pair.handshake", label: "Handshake", icon: Handshake, verb: "shake hands" },
  { kind: "fistBump", key: "people.pair.fistBump", label: "Fist bump", icon: HandFist, verb: "fist bump" },
  { kind: "hug", key: "people.pair.hug", label: "Hug", icon: HeartHandshake, verb: "hug" },
];

/** "Aline waved at you" — short notice texts for gestures aimed at someone (i18n `people.at.*`). */
export const AT_YOU: Record<number, string> = {
  [ACT.wave]: "waved at you",
  [ACT.nod]: "nodded at you",
  [ACT.thumbsUp]: "gave you a thumbs up",
  [ACT.clap]: "clapped for you",
  [ACT.laugh]: "laughed with you",
  [ACT.point]: "pointed at you",
  [ACT.shrug]: "shrugged at you",
  [ACT.shakeHead]: "shook their head at you",
};

/** Seated people can't play standing gestures: a short label above them instead ("waves"). */
export const SEATED_WORD: Record<number, string> = {
  [ACT.wave]: "waves",
  [ACT.dance]: "dances",
  [ACT.clap]: "claps",
  [ACT.cheer]: "cheers",
  [ACT.thumbsUp]: "thumbs up",
  [ACT.point]: "points",
};
