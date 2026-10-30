import { launchBrowser } from './lib.mjs';
import { mkdirSync } from 'node:fs';

// Captures the documentation gallery: title, loadout, a combat room, an upgrade pick, the boss, and an end screen.
const dir = 'docs/screenshots';
mkdirSync(dir, { recursive: true });
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
await page.goto('http://127.0.0.1:5173/?test=1&seed=42');
await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
await page.waitForTimeout(600);
await page.screenshot({ path: `${dir}/title.png` });
await page.getByRole('button', { name: 'Loadout' }).click();
await page.waitForTimeout(200);
await page.screenshot({ path: `${dir}/loadout.png` });
await page.getByRole('button', { name: 'Back' }).click();
await page.evaluate(() => window.vellum.startRun(42));
await page.evaluate(() => window.vellum.advance(0.5));
await page.evaluate(() => window.vellum.takeExit(0));
await page.evaluate(() => window.vellum.setGod(true));
await page.evaluate(() => window.vellum.advance(1.6));
await page.waitForTimeout(400);
await page.screenshot({ path: `${dir}/combat.png` });
await page.evaluate(() => window.vellum.setTopDown(true));
await page.waitForTimeout(300);
await page.screenshot({ path: `${dir}/layout-topdown.png` });
await page.evaluate(() => window.vellum.setTopDown(false));
// Play forward to the first upgrade pick, using the same aim-and-swing loop as the autopilot.
let state = null;
for (let i = 0; i < 900; i++) {
  state = await page.evaluate(() => window.vellum.advance(0.12));
  if (state.state === 'upgrade') break;
  const b = state.battle;
  const alive = (b?.enemies ?? []).filter((e) => e.stage !== 'dead');
  if (alive.length) {
    const t = alive.sort((p, q) => Math.hypot(p.x - b.pos.x, p.z - b.pos.z) - Math.hypot(q.x - b.pos.x, q.z - b.pos.z))[0];
    await page.evaluate((y) => window.vellum.setLook(y, 0), Math.atan2(-(t.x - b.pos.x), -(t.z - b.pos.z)));
    await page.mouse.click(640, 360);
  }
}
await page.waitForTimeout(350);
await page.screenshot({ path: `${dir}/upgrade.png` });
await page.keyboard.press('Digit1');
await page.waitForTimeout(100);
// Run to the boss on the god-mode path, then capture the fight.
for (let i = 0; i < 2000; i++) {
  state = await page.evaluate(() => window.vellum.advance(0.15));
  if (state.state === 'upgrade') await page.keyboard.press('Digit1');
  if (state.state === 'altar') await page.keyboard.press('Digit1');
  if (state.room?.kind === 'boss' && state.battle?.enemies.some((e) => e.kind === 'boss')) break;
  if (state.state === 'run' && state.battle?.cleared && state.room?.exits?.length) {
    await page.evaluate(() => window.vellum.takeExit(0));
  } else if (state.state === 'run' && state.battle) {
    const b = state.battle;
    const alive = (b.enemies ?? []).filter((e) => e.stage !== 'dead');
    if (alive.length) {
      const t = alive.sort((p, q) => Math.hypot(p.x - b.pos.x, p.z - b.pos.z) - Math.hypot(q.x - b.pos.x, q.z - b.pos.z))[0];
      await page.evaluate((y) => window.vellum.setLook(y, 0), Math.atan2(-(t.x - b.pos.x), -(t.z - b.pos.z)));
      await page.mouse.click(640, 360);
    }
  }
}
await page.waitForTimeout(500);
await page.screenshot({ path: `${dir}/boss.png` });
await page.evaluate(() => window.vellum.finish(true));
await page.waitForTimeout(400);
await page.screenshot({ path: `${dir}/end-win.png` });
await browser.close();
console.log('gallery written to', dir);
