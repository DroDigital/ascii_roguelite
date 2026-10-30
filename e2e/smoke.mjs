import { launchBrowser, collectErrors } from './lib.mjs';

// Boots the game, captures the title, starts a seeded run, advances time, and captures the room.
const base = process.env.BASE_URL ?? 'http://127.0.0.1:5173/?test=1';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = collectErrors(page);
await page.goto(base + '&seed=42');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.waitForTimeout(800);
await page.screenshot({ path: 'artifacts/smoke-title.png' });
const started = await page.evaluate(() => window.vellum.startRun(42));
await page.waitForTimeout(400);
const after = await page.evaluate(() => window.vellum.advance(6));
await page.waitForTimeout(600);
await page.screenshot({ path: 'artifacts/smoke-room.png' });
console.log(JSON.stringify({ started: { state: started.state, room: started.room }, after: { state: after.state, hp: after.battle?.hp, enemies: after.battle?.enemies.map((e) => `${e.kind}:${e.stage}`) }, errors: errors.slice(0, 12) }, null, 2));
await browser.close();
