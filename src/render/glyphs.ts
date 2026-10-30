import * as THREE from 'three';

/**
 * Every glyph the renderer can draw, in atlas order: space plus printable ASCII.
 * Letters are included so effects can break text apart into readable fragments.
 * ASCII only, so coverage never depends on which fonts the viewer has installed.
 */
export const GLYPH_CHARS = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');

/** Tiles per atlas row. */
export const ATLAS_COLUMNS = 16;

const GLYPH_INDEX = new Map<string, number>();
[...GLYPH_CHARS].forEach((ch, i) => GLYPH_INDEX.set(ch, i));

/** Atlas index for a character. Throws on unknown characters so typos fail fast. */
export function glyphIndex(ch: string): number {
  const i = GLYPH_INDEX.get(ch);
  if (i === undefined) throw new Error(`Glyph not in atlas: "${ch}"`);
  return i;
}

/*
 * Brightness ramps. Index 0 is empty, the last index is densest. Each surface
 * family has its own ramp so floors read as dust, walls as hatching and other
 * surfaces as ordinary shading.
 */
export const RAMP_DEFAULT = ' .:-=+*o%#@';
export const RAMP_DUST = " .'`,:;~";
export const RAMP_HATCH = ' :=+%&#@WM';

/** Edge glyphs, chosen by the orientation of a depth discontinuity. */
export const EDGE_VERTICAL = '|';
export const EDGE_HORIZONTAL = '-';
export const EDGE_FORWARD = '/';
export const EDGE_BACK = '\\';
export const EDGE_SILHOUETTE = '#';

/** Sparse glyphs for drifting fog fields. */
export const FOG_CHARS = ".:'~";

export interface GlyphAtlas {
  texture: THREE.CanvasTexture;
  tilesX: number;
  tilesY: number;
  /** Tile size in device pixels, equal to the device cell size. */
  tileW: number;
  tileH: number;
  key: string;
}

/**
 * Renders the glyph set into a texture with one tile per glyph. Each tile is
 * exactly one device cell, so the composite pass samples it 1:1. The glyph's
 * ink is written in the red channel, which is the coverage value the shader uses.
 */
export function buildGlyphAtlas(cellW: number, cellH: number, fontFamily = '"IBM Plex Mono", monospace'): GlyphAtlas {
  const chars = [...GLYPH_CHARS];
  const tilesX = ATLAS_COLUMNS;
  const tilesY = Math.ceil(chars.length / tilesX);

  const canvas = document.createElement('canvas');
  canvas.width = tilesX * cellW;
  canvas.height = tilesY * cellH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('2D canvas is unavailable for the glyph atlas');

  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  // Size glyphs to fill most of the cell height; squeeze horizontally only if needed.
  ctx.font = `${cellH * 0.8}px ${fontFamily}`;

  chars.forEach((ch, i) => {
    if (ch === ' ') return;
    const m = ctx.measureText(ch);
    const col = i % tilesX;
    const row = Math.floor(i / tilesX);
    const cx = col * cellW + cellW / 2;
    const baseline = row * cellH + cellH / 2 + (m.actualBoundingBoxAscent - m.actualBoundingBoxDescent) / 2;
    const scaleX = Math.min(1, (cellW * 0.9) / Math.max(1, m.width));
    ctx.save();
    ctx.translate(cx, baseline);
    ctx.scale(scaleX, 1);
    ctx.fillText(ch, 0, 0);
    ctx.restore();
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  texture.colorSpace = THREE.NoColorSpace;
  texture.needsUpdate = true;
  return { texture, tilesX, tilesY, tileW: cellW, tileH: cellH, key: `${cellW}x${cellH}` };
}

/** Resolves once the monospace face is available, so atlas text uses the right font. */
export async function ensureGlyphFont(fontFamily = '"IBM Plex Mono"'): Promise<void> {
  try {
    await document.fonts.load(`16px ${fontFamily}`);
  } catch {
    // Fall back to the generic monospace face; the atlas still renders.
  }
}
