import * as THREE from 'three';
import { COMPOSITE_FRAG, FULLSCREEN_VERT, reductionFragment } from './shaders';
import { type GlyphAtlas, buildGlyphAtlas, ensureGlyphFont } from './glyphs';
import { Overlay } from './overlay';
import { paletteRgb } from './palette';

/** Cell size in CSS pixels. Height is always twice the width so cells read as characters. */
export interface CellSize {
  w: number;
  h: number;
}

export interface AsciiConfig {
  cell: CellSize;
  /** Samples per cell horizontally. Vertical samples are 2× this, so sample texels stay square. */
  sampleX: 1 | 2 | 3;
  /** Brightness exponent. Above 1 darkens mid-tones, below 1 lifts them. */
  contrast: number;
  exposure: number;
  /** Relative depth jump that counts as an edge. */
  edgeThreshold: number;
  glow: number;
  vignette: number;
}

/** A radial glyph distortion in cell units, with the origin at the grid's bottom-left. */
export interface DistortionSpec {
  x: number;
  y: number;
  radius: number;
  amount: number;
}

export interface FrameInput {
  dt: number;
  /** Discards temporal history, for example after a camera cut. */
  reset?: boolean;
  distortions?: readonly DistortionSpec[];
}

const MAX_DISTORTIONS = 3;
const SMOOTH_RATE = 14;

/**
 * GPU ASCII pipeline:
 *   1. The 3D scene renders into a sample grid of cols·sx × rows·sy texels.
 *   2. A reduction pass turns each cell's samples into a glyph, a colour and a
 *      surface family, with temporal hysteresis (ping-pong state).
 *   3. A composite pass draws glyphs from the atlas per device pixel and blends
 *      the CPU overlay on top.
 * The grid is letterboxed inside the canvas. The camera aspect is the grid aspect.
 */
export class AsciiRenderer {
  readonly gl: THREE.WebGLRenderer;
  readonly overlay: Overlay;
  readonly canvas: HTMLCanvasElement;

  cols = 0;
  rows = 0;
  /** Device pixels per cell, rounded to whole pixels. */
  devCell = { w: 8, h: 16 };
  /** Device pixel offset of the grid's bottom-left corner. */
  origin = { x: 0, y: 0 };
  /** Aspect ratio the camera must use so the scene fills the grid exactly. */
  aspect = 1;

  private cfg: AsciiConfig;
  private floatType: THREE.TextureDataType = THREE.HalfFloatType;
  private atlas: GlyphAtlas | null = null;
  private sceneRT: THREE.WebGLRenderTarget | null = null;
  private cellRTs: [THREE.WebGLRenderTarget, THREE.WebGLRenderTarget] | null = null;
  private cur = 0;
  private reduceMat: THREE.RawShaderMaterial | null = null;
  private reduceSampleX = 0;
  private compMat: THREE.RawShaderMaterial;
  private quad: THREE.Mesh;
  private quadScene = new THREE.Scene();
  private quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private forceReset = true;
  private cssSize = { w: 1, h: 1, dpr: 1 };
  private atlasKey = '';
  private readonly distortUniform: THREE.Vector4[] = Array.from({ length: MAX_DISTORTIONS }, () => new THREE.Vector4());
  private readonly paletteUniform: THREE.Vector3[] = paletteRgb().map(([r, g, b]) => new THREE.Vector3(r, g, b));

  constructor(canvas: HTMLCanvasElement, cfg: AsciiConfig) {
    this.canvas = canvas;
    this.cfg = { ...cfg };
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
    this.gl.setPixelRatio(1);
    this.gl.toneMapping = THREE.NoToneMapping;
    this.gl.outputColorSpace = THREE.LinearSRGBColorSpace;
    if (!this.gl.getContext().getExtension('EXT_color_buffer_float')) {
      this.floatType = THREE.UnsignedByteType;
    }
    this.overlay = new Overlay(1, 1);

    const quadGeo = new THREE.BufferGeometry();
    quadGeo.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
    quadGeo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
    this.compMat = this.makeCompositeMaterial();
    this.quad = new THREE.Mesh(quadGeo, this.compMat);
    this.quad.frustumCulled = false;
    this.quadScene.add(this.quad);
  }

  /** Builds the glyph atlas. Must be awaited once before the first resize. */
  async init(): Promise<void> {
    await ensureGlyphFont();
  }

  get config(): AsciiConfig {
    return { ...this.cfg, cell: { ...this.cfg.cell } };
  }

  /** Updates tuning values. Changes to cell size or sample density rebuild the targets. */
  setConfig(patch: Partial<AsciiConfig>): void {
    this.cfg = { ...this.cfg, ...patch, cell: patch.cell ? { ...patch.cell } : this.cfg.cell };
    this.resize(this.cssSize.w, this.cssSize.h, this.cssSize.dpr);
  }

  /**
   * Lays out the grid for a canvas of the given CSS size and device pixel ratio.
   * Returns true when the grid size or cell size changed.
   */
  resize(cssW: number, cssH: number, dpr: number): boolean {
    this.cssSize = { w: cssW, h: cssH, dpr };
    const cell = this.cfg.cell;
    const cols = Math.max(40, Math.floor(cssW / cell.w));
    const rows = Math.max(24, Math.floor(cssH / cell.h));
    const devCell = { w: Math.max(1, Math.round(cell.w * dpr)), h: Math.max(1, Math.round(cell.h * dpr)) };
    const devW = Math.max(1, Math.round(cssW * dpr));
    const devH = Math.max(1, Math.round(cssH * dpr));

    this.gl.setSize(devW, devH, false);
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.origin = {
      x: Math.round((devW - cols * devCell.w) / 2),
      y: Math.round((devH - rows * devCell.h) / 2),
    };
    this.devCell = devCell;
    this.aspect = (cols * cell.w) / (rows * cell.h);

    const atlasKey = `${devCell.w}x${devCell.h}`;
    if (atlasKey !== this.atlasKey) {
      this.atlas?.texture.dispose();
      this.atlas = buildGlyphAtlas(devCell.w, devCell.h);
      this.atlasKey = atlasKey;
      this.compMat.uniforms.tAtlas.value = this.atlas.texture;
      this.compMat.uniforms.uAtlasTiles.value.set(this.atlas.tilesX, this.atlas.tilesY);
    }

    const gridChanged = cols !== this.cols || rows !== this.rows || !this.sceneRT || !this.cellRTs;
    const sampleChanged = this.cfg.sampleX !== this.reduceSampleX;
    if (gridChanged || sampleChanged) {
      this.cols = cols;
      this.rows = rows;
      this.overlay.resize(cols, rows);
      this.rebuildTargets();
      this.forceReset = true;
    }
    this.compMat.uniforms.uDevCell.value.set(devCell.w, devCell.h);
    this.compMat.uniforms.uOrigin.value.set(this.origin.x, this.origin.y);
    this.compMat.uniforms.uGrid.value.set(cols, rows);
    this.compMat.uniforms.uResolution.value.set(devW, devH);
    return gridChanged || atlasKey !== this.atlasKey;
  }

  /** Renders one frame: scene, reduction, composite. The camera's aspect must match `aspect`. */
  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, frame: FrameInput): void {
    if (!this.sceneRT || !this.cellRTs || !this.reduceMat || !this.atlas) {
      throw new Error('AsciiRenderer.resize() must run before render()');
    }
    const gl = this.gl;
    camera.updateMatrixWorld();

    // Pass 1: scene into the sample grid.
    gl.setRenderTarget(this.sceneRT);
    gl.render(scene, camera);

    // Pass 2: reduction into the current state buffer.
    const cur = this.cellRTs[this.cur];
    const prev = this.cellRTs[1 - this.cur];
    const r = this.reduceMat.uniforms;
    r.tColor.value = this.sceneRT.texture;
    r.tDepth.value = this.sceneRT.depthTexture;
    r.tPrev.value = prev.textures[0];
    r.uSceneSize.value.set(this.sceneRT.width, this.sceneRT.height);
    r.uNear.value = camera.near;
    r.uFar.value = camera.far;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    r.uTanHalf.value.set(tanHalf * camera.aspect, tanHalf);
    r.uViewToWorld.value.setFromMatrix4(camera.matrixWorld);
    r.uDt.value = Math.min(frame.dt, 0.1);
    r.uSmoothRate.value = SMOOTH_RATE;
    r.uContrast.value = this.cfg.contrast;
    r.uExposure.value = this.cfg.exposure;
    r.uEdgeThreshold.value = this.cfg.edgeThreshold;
    r.uReset.value = this.forceReset || frame.reset ? 1 : 0;
    this.forceReset = false;
    this.quad.material = this.reduceMat;
    gl.setRenderTarget(cur);
    gl.render(this.quadScene, this.quadCam);

    // Pass 3: composite to the canvas.
    const c = this.compMat.uniforms;
    c.tState.value = cur.textures[0];
    c.tCellColor.value = cur.textures[1];
    c.tOverlay.value = this.overlay.texture;
    c.uGlow.value = this.cfg.glow;
    c.uVignette.value = this.cfg.vignette;
    for (let i = 0; i < MAX_DISTORTIONS; i++) {
      const d = frame.distortions?.[i];
      this.distortUniform[i].set(d?.x ?? 0, d?.y ?? 0, d?.radius ?? 0, d?.amount ?? 0);
    }
    c.uPalette.value = this.paletteUniform;
    c.uDistort.value = this.distortUniform;
    this.quad.material = this.compMat;
    gl.setRenderTarget(null);
    gl.render(this.quadScene, this.quadCam);

    this.cur = 1 - this.cur;
  }

  dispose(): void {
    this.sceneRT?.dispose();
    this.cellRTs?.forEach((rt) => rt.dispose());
    this.atlas?.texture.dispose();
    this.reduceMat?.dispose();
    this.compMat.dispose();
    this.overlay.texture.dispose();
    this.gl.dispose();
  }

  private rebuildTargets(): void {
    const sx = this.cfg.sampleX;
    const sy = sx * 2;
    this.sceneRT?.dispose();
    this.cellRTs?.forEach((rt) => rt.dispose());
    this.reduceMat?.dispose();

    this.sceneRT = new THREE.WebGLRenderTarget(this.cols * sx, this.rows * sy, {
      type: this.floatType,
      depthBuffer: true,
      depthTexture: new THREE.DepthTexture(this.cols * sx, this.rows * sy),
    });
    this.sceneRT.texture.minFilter = THREE.NearestFilter;
    this.sceneRT.texture.magFilter = THREE.NearestFilter;

    const makeCellRT = (): THREE.WebGLRenderTarget => {
      const rt = new THREE.WebGLRenderTarget(this.cols, this.rows, {
        type: this.floatType,
        count: 2,
        depthBuffer: false,
      });
      rt.textures.forEach((t) => {
        t.minFilter = THREE.NearestFilter;
        t.magFilter = THREE.NearestFilter;
        t.generateMipmaps = false;
      });
      return rt;
    };
    this.cellRTs = [makeCellRT(), makeCellRT()];
    this.cur = 0;

    this.reduceMat = this.makeReductionMaterial(sx as 1 | 2 | 3);
    this.reduceSampleX = sx;
  }

  private makeReductionMaterial(sampleX: 1 | 2 | 3): THREE.RawShaderMaterial {
    const blank = new THREE.Texture();
    return new THREE.RawShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: reductionFragment(sampleX),
      uniforms: {
        tColor: { value: blank },
        tDepth: { value: null },
        tPrev: { value: blank },
        uSceneSize: { value: new THREE.Vector2(1, 1) },
        uNear: { value: 0.5 },
        uFar: { value: 80 },
        uTanHalf: { value: new THREE.Vector2(1, 1) },
        uViewToWorld: { value: new THREE.Matrix3() },
        uDt: { value: 1 / 60 },
        uSmoothRate: { value: SMOOTH_RATE },
        uContrast: { value: this.cfg.contrast },
        uExposure: { value: this.cfg.exposure },
        uEdgeThreshold: { value: this.cfg.edgeThreshold },
        uReset: { value: 1 },
      },
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
  }

  private makeCompositeMaterial(): THREE.RawShaderMaterial {
    const blank = new THREE.Texture();
    return new THREE.RawShaderMaterial({
      vertexShader: FULLSCREEN_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tState: { value: blank },
        tCellColor: { value: blank },
        tOverlay: { value: blank },
        tAtlas: { value: blank },
        uDevCell: { value: new THREE.Vector2(8, 16) },
        uOrigin: { value: new THREE.Vector2(0, 0) },
        uGrid: { value: new THREE.Vector2(1, 1) },
        uAtlasTiles: { value: new THREE.Vector2(1, 1) },
        uPalette: { value: [] as THREE.Vector3[] },
        uDistort: { value: [] as THREE.Vector4[] },
        uGlow: { value: this.cfg.glow },
        uVignette: { value: this.cfg.vignette },
        uResolution: { value: new THREE.Vector2(1, 1) },
      },
      glslVersion: THREE.GLSL3,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NoBlending,
    });
  }
}
