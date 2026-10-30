import { launchBrowser, collectErrors } from './lib.mjs';

// Enters the first combat room of a seeded run and captures the fight.
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = collectErrors(page);
await page.goto('http://127.0.0.1:5173/?test=1&seed=42');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.evaluate(() => window.vellum.startRun(42));
await page.evaluate(() => window.vellum.advance(0.5));
await page.evaluate(() => window.vellum.takeExit(0));
const s1 = await page.evaluate(() => window.vellum.advance(1.2));
await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/combat-1.png' });
const s2 = await page.evaluate(() => window.vellum.advance(4));
await page.waitForTimeout(500);
await page.screenshot({ path: 'artifacts/combat-2.png' });
console.log(JSON.stringify({
  room: s1.room,
  t1: { hp: s1.battle?.hp, enemies: s1.battle?.enemies.map((e) => `${e.kind}:${e.stage}`) },
  t2: { hp: s2.battle?.hp, kills: s2.battle?.kills, enemies: s2.battle?.enemies.map((e) => `${e.kind}:${e.stage}:${e.hp}`) },
  errors: errors.slice(0, 10),
}, null, 2));
await browser.close();
