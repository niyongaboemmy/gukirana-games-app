"use client";
import type { ReportReason } from "@gukirana/contracts";
import { api, useSession } from "@/lib/session";
import { loadLocalBlocks, saveLocalBlocks, useSocial, type BlockedPerson } from "./social-store";

export interface PublicProfile {
  id: string;
  username: string;
  color: string;
  level: number;
  memberSince: string;
  ratings: Record<string, { rating: number; games: number; wins: number }>;
}

const authed = () => useSession.getState().status === "authenticated";

/** Block list for this account (API), merged with this device's cache; returns realtime block keys. */
export async function loadBlocks(): Promise<string[]> {
  let list: BlockedPerson[] = loadLocalBlocks();
  if (authed()) {
    try {
      const r = await api<{ blocks: { id: string; username: string }[] }>("/me/blocks");
      list = r.blocks.map((b) => ({ key: `u:${b.id}`, uid: b.id, name: b.username }));
    } catch {
      /* offline: keep the cached list */
    }
  }
  useSocial.setState({ blocked: list });
  saveLocalBlocks(list);
  return list.map((b) => b.key);
}

export async function persistBlock(p: BlockedPerson): Promise<void> {
  const list = [...useSocial.getState().blocked.filter((b) => b.key !== p.key), p];
  useSocial.setState({ blocked: list });
  saveLocalBlocks(list);
  if (p.uid && authed()) await api(`/me/blocks/${p.uid}`, { method: "PUT" }).catch(() => undefined);
}

export async function persistUnblock(key: string): Promise<void> {
  const p = useSocial.getState().blocked.find((b) => b.key === key);
  const list = useSocial.getState().blocked.filter((b) => b.key !== key);
  useSocial.setState({ blocked: list });
  saveLocalBlocks(list);
  if (p?.uid && authed()) await api(`/me/blocks/${p.uid}`, { method: "DELETE" }).catch(() => undefined);
}

const profiles = new Map<string, Promise<PublicProfile>>();
export function fetchProfile(uid: string): Promise<PublicProfile> {
  let p = profiles.get(uid);
  if (!p) {
    p = api<PublicProfile>(`/players/${uid}`);
    p.catch(() => profiles.delete(uid));
    profiles.set(uid, p);
  }
  return p;
}

export function sendReport(input: { targetId: string; reason: ReportReason; details?: string; context?: { place?: string; chat?: { name: string; text: string; t: number }[] } }) {
  return api<{ id: string }>("/reports", { method: "POST", body: JSON.stringify(input) });
}
