import { launchBrowser, collectErrors } from './lib.mjs';

// Plays a full run with a simple autopilot: aims at the nearest enemy, swings the glaive,
// dodges wind-ups, takes the first exit, picks the first upgrade, and records what it saw.
// Usage: node e2e/autoplay.mjs [seed] [god=0|1]
const seed = Number(process.argv[2] ?? 42);
const god = process.argv[3] !== '0';
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = collectErrors(page);
await page.goto(`http://127.0.0.1:5173/?test=1&seed=${seed}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
await page.evaluate((g) => window.vellum.setGod(g), god);
await page.evaluate((s) => window.vellum.startRun(s), seed);

const log = { rooms: [], upgrades: [], combos: [], events: [], finalState: null, steps: 0, bossSeen: false };
let lastRoom = null;
let lastState = null;
const shot = { upgrade: false, boss: false };
let altarDone = false;
for (let i = 0; i < Number(process.env.STEPS ?? 600); i++) {
  const s = await page.evaluate(() => {
    const st = window.vellum.state();
    const enemies = st.battle?.enemies.filter((e) => e.stage !== 'dead') ?? [];
    return { st, enemies };
  });
  const st = s.st;
  log.steps = i;
  if (st.state === 'run' && st.room?.kind === 'boss' && !shot.boss && st.battle?.enemies.length) {
    shot.boss = true;
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'artifacts/boss-room.png' });
  }
  if (st.state === 'end') {
    log.finalState = st.director ? { stage: st.director.stage, kills: st.director.kills, owned: st.director.owned } : null;
    await page.waitForTimeout(400);
    await page.screenshot({ path: 'artifacts/end-screen.png' });
    break;
  }
  const roomKey = st.room ? `${st.room.templateId}` : null;
  if (roomKey && roomKey !== lastRoom) {
    log.rooms.push({ room: roomKey, kind: st.room.kind, at: Math.round(st.runTime) });
    lastRoom = roomKey;
  }
  if (st.state !== lastState) {
    log.events.push(`state ${lastState} -> ${st.state} @${Math.round(st.runTime)}s`);
    lastState = st.state;
  }
  if (st.state === 'upgrade') {
    if (!shot.upgrade) {
      shot.upgrade = true;
      await page.waitForTimeout(300);
      await page.screenshot({ path: 'artifacts/upgrade-screen.png' });
    }
    log.upgrades.push(st.director.offers[0]);
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(60);
    continue;
  }
  if (st.state === 'altar') {
    log.events.push('altar screen');
    await page.keyboard.press('Digit1');
    await page.waitForTimeout(60);
    continue;
  }
  if (st.state === 'run' && st.battle && st.room?.kind === 'cistern' && altarDone) altarDone = true;
  if (st.state === 'run' && st.battle) {
    const b = st.battle;
    const alive = s.enemies;
    if (alive.some((e) => e.kind === 'boss')) log.bossSeen = true;
    if (alive.length > 0) {
      let nearest = alive[0];
      let best = Infinity;
      for (const e of alive) {
        const d = Math.hypot(e.x - b.pos.x, e.z - b.pos.z);
        if (d < best) {
          best = d;
          nearest = e;
        }
      }
      const yaw = Math.atan2(-(nearest.x - b.pos.x), -(nearest.z - b.pos.z));
      await page.evaluate((y) => window.vellum.setLook(y, 0), yaw);
      // Walk toward the target until it is inside melee reach, then hold position and swing.
      if (best > 2.2) await page.keyboard.down('KeyW');
      else await page.keyboard.up('KeyW');
      await page.evaluate(() => window.vellum.advance(0.12));
      await page.mouse.click(640, 360);
      if (best < 2.8 && alive.some((e) => e.stage === 'windup') && i % 9 === 0) {
        await page.keyboard.press('Space');
      }
    } else if (b.cleared && st.room?.altars?.length && !altarDone) {
      // Cistern: walk to the altar, consult it, and mend.
      const altar = st.room.altars[0];
      const d = Math.hypot(altar.x - b.pos.x, altar.z - b.pos.z);
      if (d > 1.4) {
        const yaw = Math.atan2(-(altar.x - b.pos.x), -(altar.z - b.pos.z));
        await page.evaluate((y) => window.vellum.setLook(y, 0), yaw);
        await page.keyboard.down('KeyW');
        await page.evaluate(() => window.vellum.advance(0.15));
      } else {
        await page.keyboard.up('KeyW');
        await page.keyboard.press('KeyE');
        altarDone = true;
        log.events.push('altar consulted');
      }
    } else if (b.cleared) {
      await page.keyboard.up('KeyW');
      const pick = Number(process.env.AUTOPILOT_EXIT ?? 0);
      const exit = st.room?.exits?.find((e) => e.index === pick) ?? st.room?.exits?.[0];
      await page.evaluate((idx) => window.vellum.takeExit(idx), exit?.index ?? 0);
    }
  }
  await page.evaluate(() => window.vellum.advance(0.15));
}
const fin = await page.evaluate(() => window.vellum.state());
log.final = { state: fin.state, owned: fin.director?.owned, hp: fin.battle?.hp, kills: fin.battle?.kills, stage: fin.director?.stage, pos: fin.battle?.pos, cleared: fin.battle?.cleared, enemies: fin.battle?.enemies.map((e) => [e.kind, e.stage, Math.round(e.hp), +e.x.toFixed(1), +e.z.toFixed(1)]) };
console.log(JSON.stringify({ seed, god, ...log, errors: errors.slice(0, 15) }, null, 2));
await page.screenshot({ path: 'artifacts/autoplay-final.png' });
await browser.close();
