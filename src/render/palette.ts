/**
 * The restrained accent palette. Only these hues carry meaning in the game:
 * ivory is the world, ember is danger, amber is resources, cyan is abilities,
 * ash is fog and inactive things. Overlay glyphs pick a slot by index.
 */
export const PAL = {
  ivory: 0,
  ember: 1,
  amber: 2,
  cyan: 3,
  ash: 4,
  white: 5,
} as const;

export const PALETTE_HEX: readonly string[] = [
  '#efe6cf', // ivory
  '#ff5a3c', // ember
  '#ffb84a', // amber
  '#5fe6e0', // cyan
  '#6b6860', // ash
  '#fff9ea', // white
];

/** Palette as normalised sRGB triples, in slot order. */
export function paletteRgb(): [number, number, number][] {
  return PALETTE_HEX.map((hex) => {
    const n = Number.parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  });
}
