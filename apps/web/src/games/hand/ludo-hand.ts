/** Which side of the board a Ludo player's hand comes from (P2-GAME-07): you from the bottom, then clockwise round the table. */
export function ludoHandSide(seat: number, mySeat: number): number {
  const off = (((seat - mySeat) % 4) + 4) % 4;
  return [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2][off]!;
}
