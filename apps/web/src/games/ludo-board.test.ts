import { describe, expect, it } from "vitest";
import { BASE_ORIGIN, CENTRE_SIDE, HOME_COLUMN, SEAT_COLORS, SEAT_COLORS_CB, sideOfCell, TRACK_COORDS, tokenCell } from "./ludo-board";

describe("ludo board geometry and colours", () => {
  it("each centre triangle sits on the side its seat's home column enters from (red W, green N, yellow E, blue S)", () => {
    expect(CENTRE_SIDE).toEqual(["left", "top", "right", "bottom"]);
    HOME_COLUMN.forEach((col, seat) => {
      for (const cell of col) expect(sideOfCell(cell)).toBe(CENTRE_SIDE[seat]);
      // finished tokens are drawn inside their own triangle
      expect(sideOfCell(tokenCell(seat, 56, 0))).toBe(CENTRE_SIDE[seat]);
    });
  });

  it("start square next to its own yard; the last track square leads into its own home column", () => {
    for (let seat = 0; seat < 4; seat++) {
      const [sr, sc] = TRACK_COORDS[seat * 13]!;
      const [br, bc] = BASE_ORIGIN[seat]!;
      expect(sr >= br - 1 && sr <= br + 6 && sc >= bc - 1 && sc <= bc + 6).toBe(true);
      const [lr, lc] = tokenCell(seat, 50, 0);
      const [hr, hc] = HOME_COLUMN[seat]![0]!;
      expect(Math.abs(lr - hr) + Math.abs(lc - hc)).toBe(1);
    }
  });

  it("the track is a closed loop of 52 distinct cells", () => {
    expect(new Set(TRACK_COORDS.map(([r, c]) => `${r},${c}`)).size).toBe(52);
    TRACK_COORDS.forEach(([r, c], i) => {
      const [nr, nc] = TRACK_COORDS[(i + 1) % 52]!;
      expect(Math.abs(nr - r) + Math.abs(nc - c)).toBeLessThanOrEqual(2); // the arm corners step diagonally
    });
  });

  it("both palettes have four distinct colours in seat order", () => {
    expect(new Set(SEAT_COLORS).size).toBe(4);
    expect(new Set(SEAT_COLORS_CB).size).toBe(4);
  });
});
