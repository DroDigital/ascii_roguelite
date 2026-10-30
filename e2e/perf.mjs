import { launchBrowser, collectErrors } from './lib.mjs';

// Frame-time harness. Renders a combat room at 1920x1080 for each quality preset.
// Numbers come from headless software WebGL (SwiftShader), so they are a relative
// proxy for the pipeline's cost, not a measurement on a real GPU. See docs/PERFORMANCE.md.
const width = Number(process.env.W ?? 1920);
const height = Number(process.env.H ?? 1080);
const frames = Number(process.env.FRAMES ?? 90);
const presets = (process.env.PRESETS ?? 'low,medium,high').split(',');
const browser = await launchBrowser();
const out = [];
for (const quality of presets) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = collectErrors(page);
  await page.goto('http://127.0.0.1:5173/?test=1&seed=42');
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.evaluate((q) => window.vellum.setQuality(q, 'standard'), quality);
  await page.evaluate(() => window.vellum.setSyncGpu(true));
  await page.evaluate(() => window.vellum.startRun(42));
  await page.evaluate(() => window.vellum.takeExit(0));
  await page.waitForTimeout(1500);
  const before = await page.evaluate(() => window.vellum.frameStats().samples.length);
  const t0 = Date.now();
  await page.waitForFunction((n) => window.vellum.frameStats().samples.length >= n + 60, before, { timeout: 600000, polling: 250 });
  const elapsed = (Date.now() - t0) / 1000;
  const stats = await page.evaluate(() => window.vellum.frameStats());
  const s = stats.samples.slice(-frames).sort((a, b) => a - b);
  const median = s[Math.floor(s.length / 2)];
  const p95 = s[Math.floor(s.length * 0.95)];
  const mean = s.reduce((a, b) => a + b, 0) / s.length;
  out.push({
    quality,
    canvas: stats.canvas,
    grid: stats.grid,
    frames: s.length,
    medianMs: +median.toFixed(1),
    p95Ms: +p95.toFixed(1),
    meanMs: +mean.toFixed(1),
    proxyFps: +(1000 / median).toFixed(1),
    wallFps: +(s.length / elapsed).toFixed(1),
    errors: errors.length,
  });
  await page.close();
}
console.log(JSON.stringify({ viewport: { width, height }, host: 'headless Chromium, SwiftShader (software WebGL2)', results: out }, null, 2));
await browser.close();
