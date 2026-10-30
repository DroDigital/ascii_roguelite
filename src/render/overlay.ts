import * as THREE from 'three';
import { glyphIndex } from './glyphs';

/**
 * CPU-side glyph layer drawn over the 3D cells. Effects write here: slash arcs,
 * telegraph patterns, debris, fragment streams. Texel layout is bottom-up, the
 * same as the cell grid in the shader: R = glyph index, G = palette slot,
 * B = alpha. Alpha 0 means no overlay glyph in that cell.
 */
export class Overlay {
  cols = 0;
  rows = 0;
  private data = new Uint8Array(0);
  private tex: THREE.DataTexture;

  constructor(cols: number, rows: number) {
    this.tex = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat);
    this.resize(cols, rows);
  }

  get texture(): THREE.DataTexture {
    return this.tex;
  }

  resize(cols: number, rows: number): void {
    if (cols === this.cols && rows === this.rows) return;
    this.cols = cols;
    this.rows = rows;
    this.data = new Uint8Array(cols * rows * 4);
    this.tex.dispose();
    this.tex = new THREE.DataTexture(this.data, cols, rows, THREE.RGBAFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.NearestFilter;
    this.tex.minFilter = THREE.NearestFilter;
    this.tex.generateMipmaps = false;
    this.tex.flipY = false;
    this.tex.needsUpdate = true;
  }

  clear(): void {
    this.data.fill(0);
  }

  /**
   * Writes one glyph at a cell. `cx` and `cy` are bottom-up cell indices. A
   * write only replaces what is already there when its alpha is at least as strong.
   */
  put(cx: number, cy: number, glyph: string | number, palette: number, alpha: number): void {
    if (alpha <= 0 || cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return;
    const i = (cy * this.cols + cx) * 4;
    const a = Math.min(255, Math.round(alpha * 255));
    if (a < this.data[i + 2]) return;
    this.data[i] = typeof glyph === 'string' ? glyphIndex(glyph) : glyph;
    this.data[i + 1] = palette;
    this.data[i + 2] = a;
  }

  /**
   * Projects a world point through the camera and writes a glyph at the cell it lands in.
   * Returns false when the point is behind the camera or off the grid.
   */
  putWorld(
    camera: THREE.Camera,
    point: THREE.Vector3,
    glyph: string | number,
    palette: number,
    alpha: number,
    scratch: THREE.Vector3 = new THREE.Vector3(),
  ): boolean {
    scratch.copy(point).project(camera);
    if (scratch.z > 1 || scratch.z < -1) return false;
    const cx = Math.floor((scratch.x * 0.5 + 0.5) * this.cols);
    const cy = Math.floor((scratch.y * 0.5 + 0.5) * this.rows);
    if (cx < 0 || cy < 0 || cx >= this.cols || cy >= this.rows) return false;
    this.put(cx, cy, glyph, palette, alpha);
    return true;
  }

  /** Marks the texture for upload. Call once per frame after writing. */
  upload(): void {
    this.tex.needsUpdate = true;
  }
}
