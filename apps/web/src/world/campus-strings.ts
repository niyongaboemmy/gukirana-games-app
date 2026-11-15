/** Campus aerial view strings (i18n source, English). */
export const CAMPUS = {
  campus: "Gukirana Playground",
  plaza: "Gukirana Plaza",
  gate: "Main Gate",
  help: "Help desk and Cafe",
  closed: "Opening soon",
  view: "Campus view",
  backToMe: "Back to me",
  hint: "Drag to turn · zoom in to come back down",
} as const;

/** Campus frontage, roads and wayfinding (P2-WLD-12), i18n keys `campus.site.*` (English catalogue). */
export const SITE = {
  /** the lit sign at the gate forecourt */
  gateSign: "GUKIRANA PLAYGROUND",
  gateSub: "Musanze",
  road: "Musanze Road",
  busStop: "BUS",
  parking: "P",
  district: {
    east: "East district",
    west: "West district",
    northEast: "North-east district",
    northWest: "North-west district",
    view: "Volcano view",
  },
  plaza: "Plaza",
  /** the gateway arch over the Fight Games walk (P2-WLD-13), `campus.site.fightGateway*` */
  fightGateway: "FIGHT GAMES",
  fightGatewaySub: (m: number, s: number) => `${m} m · ${s} s walk`,
  plot: (n: number) => `Hall plot ${n}`,
  /** a wayfinding row: metres and walking time */
  walk: (m: number, s: number) => `${m} m · ${s < 60 ? `${s} s` : `${Math.round(s / 60)} min`}`,
} as const;
