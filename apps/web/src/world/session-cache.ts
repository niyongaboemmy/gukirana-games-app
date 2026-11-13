/**
 * Session-lifetime memo for deterministic, expensive scene builds (procedural terrain, volcano meshes, vegetation
 * placements, canvas textures) that more than one mount uses: the plaza's landscape and every hall's window view
 * (rooms/OutdoorView) build the same Northern-Rwanda backdrop. The first mount pays once; later mounts reuse the
 * very same geometry / texture objects, which are then already uploaded to the GPU (P1-WLD-05: walking up to a hall
 * must not stall on a second, synchronous landscape build).
 *
 * Entries live for the whole session and are never disposed (the plaza keeps using them); only put things here
 * that are pure functions of their key.
 */
const store = new Map<string, unknown>();

export function sessionMemo<T>(key: string, make: () => T): T {
  if (store.has(key)) return store.get(key) as T;
  const v = make();
  store.set(key, v);
  return v;
}
