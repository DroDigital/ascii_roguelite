# Performance

## What was measured, and where

Every number here comes from headless Chromium running **software WebGL2** (SwiftShader) on a machine with no GPU. The harness is `npm run perf` (`e2e/perf.mjs`). It loads a seeded run, enters a combat room, and records per-frame timings for 90 frames at each quality preset (`FRAMES` changes the count). The wall-clock rate is computed from those same frames and their elapsed time.

These numbers are useful for two things:

- **JavaScript cost per frame.** This is the simulation, the overlay, the effects and the submission of the render passes. It does not depend on the GPU, so it is a fair estimate of CPU cost on any machine.
- **Relative cost of the render passes.** Changing sample density or resolution moves the wall-clock rate, so the scaling is informative even though the absolute numbers are not.

They are **not** a measurement of GPU performance. Software GL runs every shader on the CPU, so the wall-clock frame rate here is dominated by emulation and will be far lower than on real hardware. **The 60 FPS target on the stated baseline has not been verified.**

## Results (final build)

Viewport 1920×1080 at device pixel ratio 1, glyph density Standard (8×16 CSS-pixel cells, 240×67 grid), 90 frames per preset:

| Quality | Samples per cell | JS median (ms) | JS p95 (ms) | JS mean (ms) | Wall-clock FPS (software GL) |
|---|---|---|---|---|---|
| Low | 2 | 2.3 | 6.1 | 2.8 | 4.7 |
| Medium | 8 | 2.1 | 5.6 | 2.6 | 4.3 |
| High | 18 | 2.2 | 5.5 | 2.7 | 4.1 |

Viewport 1280×720, same settings (160×45 grid):

| Quality | JS median (ms) | JS p95 (ms) | Wall-clock FPS (software GL) |
|---|---|---|---|
| Low | 2.0 | 4.9 | 9.0 |
| Medium | 2.0 | 4.1 | 8.0 |
| High | 2.1 | 3.8 | 7.8 |

Reading the tables:

- JavaScript cost is about 2 ms at both resolutions and does not change measurably with sample density. The per-frame work is the simulation, the effects and the overlay. The differences between presets are within run-to-run noise, a few tenths of a millisecond.
- Wall-clock rate scales roughly with pixel count (1080p to 720p is about 1.9× faster), which points at the full-screen composite pass. The sample-density setting barely moves it under software GL.
- An earlier version of this harness divided 90 samples by the time for about 60 frames, which overstated the wall-clock rate by roughly half. The figures above come from the corrected harness.

## The 60 FPS baseline

The target in the brief is 60 FPS at 1080p. The stated baseline for this build is a desktop with a GTX 1060-class GPU (6 GB) or an Intel UHD 630-class integrated GPU, running a current Chromium with WebGL2 and float colour buffers. **This baseline has not been tested.** The pipeline does a few hundred draw calls and two small fullscreen passes per frame, so real hardware should be far faster than software GL, but that is an expectation, not a measurement.

## Quality settings

| Setting | What it changes | Cost direction |
|---|---|---|
| Glyph density (Fine 6×12, Standard 8×16, Bold 10×20 CSS px) | Number of cells on screen | Fine costs the most (more cells, more composite work) |
| Render quality (Low 1, Medium 2, High 3 samples per cell horizontally) | Supersampling of the scene before cells are reduced | High costs more in the reduction pass |
| Effects intensity | Particle counts, fog strength, distortion and flash strength | Scales CPU work and overlay writes |
| Reduced motion | Disables shake, camera kicks, distortion, bob and hit-stop; caps effects at 50% | Lowers CPU work |

Frame stats can be shown in the settings menu. They report the JavaScript time per frame, labelled as CPU-side, so they can be compared across machines without implying GPU time.

## How to measure on real hardware

```bash
npm run dev            # in one terminal
npm run perf           # in another; uses CHROME_PATH or the pre-installed Chromium
```

Set `W=1920 H=1080`, `PRESETS=low,medium,high` and `FRAMES=90` as needed. For a GPU measurement, run it in a browser on the baseline machine, check `chrome://gpu` to confirm WebGL2 is hardware-accelerated, and record the wall-clock FPS. The `setSyncGpu` test hook makes each frame wait for the GPU to finish, so the JavaScript timings include GPU execution in that mode.
