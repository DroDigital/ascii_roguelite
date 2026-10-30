import {
  EDGE_BACK,
  EDGE_FORWARD,
  EDGE_HORIZONTAL,
  EDGE_SILHOUETTE,
  EDGE_VERTICAL,
  RAMP_DEFAULT,
  RAMP_DUST,
  RAMP_HATCH,
  glyphIndex,
} from './glyphs';

/** Shared vertex stage for every fullscreen pass: a single oversized triangle. */
export const FULLSCREEN_VERT = `precision highp float;
in vec3 position;
in vec2 uv;
out vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

/** Hysteresis band, in ramp levels, that keeps a glyph from flickering at a boundary. */
export const GLYPH_DEADBAND = 0.6;

function floatArray(name: string, chars: string): string {
  const values = [...chars].map((c) => `${glyphIndex(c)}.0`);
  return `const float ${name}[${values.length}] = float[${values.length}](${values.join(', ')});`;
}

function glyphConst(name: string, ch: string): string {
  return `const float ${name} = ${glyphIndex(ch)}.0;`;
}

/**
 * Pass 2, reduction. One fragment per output cell. Averages the cell's
 * supersamples into a brightness, colour and surface family, decides the glyph
 * with edge and ramp rules, and smooths it over time so structure does not flicker.
 *
 * Outputs:
 *   outState  (glyph index / 255, smoothed brightness, edge strength, surface family / 255)
 *   outColor  (sRGB cell colour, smoothed brightness)
 *
 * The glyph index and family are stored divided by 255. Without float colour
 * buffers the targets are unsigned bytes, which clamp anything above 1, so the
 * indices would collapse to a single glyph there. Readers multiply back by 255.
 */
export function reductionFragment(sampleX: number): string {
  const sampleY = sampleX * 2;
  return `precision highp float;
precision highp int;

uniform sampler2D tColor;
uniform sampler2D tDepth;
uniform sampler2D tPrev;
uniform vec2 uSceneSize;
uniform float uNear;
uniform float uFar;
uniform vec2 uTanHalf;
uniform mat3 uViewToWorld;
uniform float uDt;
uniform float uSmoothRate;
uniform float uContrast;
uniform float uExposure;
uniform float uEdgeThreshold;
uniform float uReset;

layout(location = 0) out vec4 outState;
layout(location = 1) out vec4 outColor;

#define SX ${sampleX}
#define SY ${sampleY}
const float DEADBAND = ${GLYPH_DEADBAND};
${floatArray('RAMP_DEFAULT', RAMP_DEFAULT)}
${floatArray('RAMP_DUST', RAMP_DUST)}
${floatArray('RAMP_HATCH', RAMP_HATCH)}
${glyphConst('G_VERT', EDGE_VERTICAL)}
${glyphConst('G_HORZ', EDGE_HORIZONTAL)}
${glyphConst('G_FWD', EDGE_FORWARD)}
${glyphConst('G_BACK', EDGE_BACK)}
${glyphConst('G_STRONG', EDGE_SILHOUETTE)}

int rampLen(int fam) {
  if (fam == 1) return ${RAMP_DUST.length};
  if (fam == 2) return ${RAMP_HATCH.length};
  return ${RAMP_DEFAULT.length};
}

float rampGlyph(int fam, int k) {
  if (fam == 1) return RAMP_DUST[k];
  if (fam == 2) return RAMP_HATCH[k];
  return RAMP_DEFAULT[k];
}

float linDepth(float d) {
  return uNear * uFar / (uFar - d * (uFar - uNear));
}

ivec2 clampTexel(ivec2 t) {
  return clamp(t, ivec2(0), ivec2(uSceneSize) - ivec2(1));
}

vec3 viewPosAt(ivec2 t, float z) {
  vec2 ndc = ((vec2(t) + 0.5) / uSceneSize) * 2.0 - 1.0;
  return vec3(ndc * uTanHalf * z, -z);
}

void main() {
  ivec2 cell = ivec2(gl_FragCoord.xy);
  ivec2 base = cell * ivec2(SX, SY);

  float lumSum = 0.0;
  vec3 colSum = vec3(0.0);
  float edgeMax = 0.0;
  vec2 edgeDir = vec2(0.0);
  vec3 normalSum = vec3(0.0);
  float geomCount = 0.0;

  for (int j = 0; j < SY; j++) {
    for (int i = 0; i < SX; i++) {
      ivec2 sp = base + ivec2(i, j);
      vec3 tm = texelFetch(tColor, sp, 0).rgb * uExposure;
      tm = tm / (1.0 + tm);
      lumSum += dot(tm, vec3(0.2126, 0.7152, 0.0722));
      colSum += tm;

      float dC = texelFetch(tDepth, sp, 0).r;
      if (dC < 0.99999) {
        geomCount += 1.0;
        float zC = linDepth(dC);
        float zR = linDepth(texelFetch(tDepth, clampTexel(sp + ivec2(1, 0)), 0).r);
        float zL = linDepth(texelFetch(tDepth, clampTexel(sp + ivec2(-1, 0)), 0).r);
        float zU = linDepth(texelFetch(tDepth, clampTexel(sp + ivec2(0, 1)), 0).r);
        float zD = linDepth(texelFetch(tDepth, clampTexel(sp + ivec2(0, -1)), 0).r);
        float jump = max(
          max(abs(zR - zC) / min(zR, zC), abs(zL - zC) / min(zL, zC)),
          max(abs(zU - zC) / min(zU, zC), abs(zD - zC) / min(zD, zC))
        );
        edgeMax = max(edgeMax, jump);
        vec2 g = vec2(zR - zL, zU - zD);
        float gl = length(g);
        if (gl > 1e-6) edgeDir += (g / gl) * jump;

        vec3 pC = viewPosAt(sp, zC);
        vec3 n = cross(viewPosAt(sp + ivec2(1, 0), zR) - pC, viewPosAt(sp + ivec2(0, 1), zU) - pC);
        float nl = length(n);
        if (nl > 1e-9) {
          n /= nl;
          if (dot(n, pC) > 0.0) n = -n;
          normalSum += n;
        }
      }
    }
  }

  float total = float(SX * SY);
  float lum = lumSum / total;
  float level = clamp(pow(lum * 1.3, uContrast), 0.0, 1.0);
  vec3 srgb = pow(clamp(colSum / total, 0.0, 1.0), vec3(1.0 / 2.2));

  float upness = 0.0;
  float nLen = length(normalSum);
  if (nLen > 1e-4) upness = (uViewToWorld * (normalSum / nLen)).y;

  vec4 prev = texelFetch(tPrev, cell, 0);
  float prevGlyph = floor(prev.r * 255.0 + 0.5);
  int prevFam = int(floor(prev.a * 255.0 + 0.5));
  bool reset = uReset > 0.5;

  float S = reset ? level : mix(prev.g, level, 1.0 - exp(-uSmoothRate * uDt));

  float edgeThr = (!reset && prevFam == 3) ? uEdgeThreshold * 0.7 : uEdgeThreshold;
  float glyph;
  int fam;
  if (geomCount > 0.0 && edgeMax > edgeThr) {
    fam = 3;
    if (edgeMax > 1.2) {
      glyph = G_STRONG;
    } else if (abs(edgeDir.x) > 2.0 * abs(edgeDir.y)) {
      glyph = G_VERT;
    } else if (abs(edgeDir.y) > 2.0 * abs(edgeDir.x)) {
      glyph = G_HORZ;
    } else {
      glyph = (edgeDir.x * edgeDir.y > 0.0) ? G_BACK : G_FWD;
    }
  } else {
    if (geomCount <= 0.0) {
      fam = 0;
    } else if (upness > 0.55) {
      fam = 1;
    } else if (abs(upness) < 0.35) {
      fam = 2;
    } else {
      fam = 0;
    }
    int n = rampLen(fam);
    float fl = S * float(n - 1);
    int idx = int(floor(fl + 0.5));
    if (!reset && fam == prevFam) {
      for (int k = 0; k < 12; k++) {
        if (k >= n) break;
        if (abs(rampGlyph(fam, k) - prevGlyph) < 0.5) {
          if (abs(fl - float(k)) < DEADBAND) idx = k;
          break;
        }
      }
    }
    glyph = rampGlyph(fam, idx);
  }

  outState = vec4(glyph / 255.0, S, edgeMax, float(fam) / 255.0);
  outColor = vec4(srgb, S);
}
`;
}

/**
 * Pass 3, composite. Runs per device pixel. Looks up the cell, applies radial
 * distortion from powerful attacks, draws the cell's glyph from the atlas in
 * its colour, adds a faint neighbour glow, and blends the CPU overlay on top.
 */
export const COMPOSITE_FRAG = `precision highp float;
precision highp int;

uniform sampler2D tState;
uniform sampler2D tCellColor;
uniform sampler2D tOverlay;
uniform sampler2D tAtlas;
uniform vec2 uDevCell;
uniform vec2 uOrigin;
uniform vec2 uGrid;
uniform vec2 uAtlasTiles;
uniform vec3 uPalette[6];
uniform vec4 uDistort[3];
uniform float uGlow;
uniform float uVignette;
uniform vec2 uResolution;

out vec4 outColor;

float glyphCoverage(float gi, vec2 f) {
  float tx = mod(gi, uAtlasTiles.x);
  float ty = floor(gi / uAtlasTiles.x);
  vec2 uv = vec2((tx + f.x) / uAtlasTiles.x, 1.0 - (ty + (1.0 - f.y)) / uAtlasTiles.y);
  return texture(tAtlas, uv).r;
}

void main() {
  vec2 cellF = (gl_FragCoord.xy - uOrigin) / uDevCell;

  vec2 offset = vec2(0.0);
  for (int i = 0; i < 3; i++) {
    vec4 d = uDistort[i];
    if (d.w > 0.0) {
      vec2 v = cellF - d.xy;
      float r = length(v);
      float ring = exp(-pow((r - d.z) / 1.1, 2.0));
      offset += (v / max(r, 1e-3)) * d.w * ring;
    }
  }
  vec2 cc = cellF + offset;

  if (cc.x < 0.0 || cc.y < 0.0 || cc.x >= uGrid.x || cc.y >= uGrid.y) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }

  ivec2 cell = ivec2(floor(cc));
  ivec2 maxCell = ivec2(uGrid) - ivec2(1);
  vec2 f = fract(cc);

  vec4 st = texelFetch(tState, cell, 0);
  vec4 cc4 = texelFetch(tCellColor, cell, 0);
  float cov = glyphCoverage(floor(st.r * 255.0 + 0.5), f);
  vec3 col = cc4.rgb * cov;

  vec3 nb = texelFetch(tCellColor, clamp(cell + ivec2(1, 0), ivec2(0), maxCell), 0).rgb
    + texelFetch(tCellColor, clamp(cell + ivec2(-1, 0), ivec2(0), maxCell), 0).rgb
    + texelFetch(tCellColor, clamp(cell + ivec2(0, 1), ivec2(0), maxCell), 0).rgb
    + texelFetch(tCellColor, clamp(cell + ivec2(0, -1), ivec2(0), maxCell), 0).rgb;
  col += nb * 0.25 * uGlow * cc4.a * cc4.a;

  vec4 ov = texelFetch(tOverlay, cell, 0);
  if (ov.b > 0.0) {
    float ovGlyph = floor(ov.r * 255.0 + 0.5);
    int pal = int(floor(ov.g * 255.0 + 0.5));
    float ovCov = glyphCoverage(ovGlyph, f);
    col = mix(col, uPalette[pal] * ovCov, ov.b * ovCov);
  }

  vec2 uvScreen = gl_FragCoord.xy / uResolution - 0.5;
  float vig = 1.0 - uVignette * smoothstep(0.32, 0.8, length(uvScreen) * 1.25);
  outColor = vec4(col * vig, 1.0);
}
`;
