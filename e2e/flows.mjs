import { launchBrowser, collectErrors } from './lib.mjs';

// Drives the real menus with mouse and keyboard and checks the outcome of each step.
const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  if (!ok) process.exitCode = 1;
};

const browser = await launchBrowser();
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const page = await context.newPage();
const errors = collectErrors(page);
const url = 'http://127.0.0.1:5173/?test=1&seed=11';

await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
check('title screen is the starting state', (await page.evaluate(() => window.vellum.state().state)) === 'title');

// Settings: change contrast with the slider, then confirm it persists across a reload.
await page.getByRole('button', { name: 'Settings' }).click();
check('settings opens from the title', (await page.evaluate(() => window.vellum.state().state)) === 'settings');
await page.evaluate(() => {
  const input = document.querySelector('#screens input[type="range"]');
  if (!input) return;
  const rows = [...document.querySelectorAll('#screens .setting')];
  const contrast = rows.find((r) => r.textContent.includes('Contrast'));
  const range = contrast?.querySelector('input[type="range"]');
  if (range) {
    range.value = '1.3';
    range.dispatchEvent(new Event('input', { bubbles: true }));
  }
});
const storedContrast = await page.evaluate(() => JSON.parse(localStorage.getItem('vellum.settings.v1') ?? '{}').contrast);
check('contrast slider saves to local storage', Math.abs(storedContrast - 1.3) < 0.01, `stored ${storedContrast}`);
await page.getByRole('button', { name: 'Back' }).click();
check('back returns to the title', (await page.evaluate(() => window.vellum.state().state)) === 'title');

// Loadout: the Quill is locked until a run is finished.
await page.getByRole('button', { name: 'Loadout' }).click();
await page.getByRole('button', { name: /Glyph Quill/ }).click();
check('the locked Quill cannot be chosen', (await page.evaluate(() => window.vellum.app.loadout.weapon)) === 'glaive');
await page.getByRole('button', { name: 'Back' }).click();

// Begin, pause and resume.
await page.getByRole('button', { name: 'Begin run' }).click();
await page.waitForTimeout(200);
check('begin run enters the run', (await page.evaluate(() => window.vellum.state().state)) === 'run');
await page.keyboard.press('KeyP');
await page.waitForTimeout(150);
check('P pauses the run', (await page.evaluate(() => window.vellum.state().state)) === 'paused');
const pausedTime = await page.evaluate(() => window.vellum.state().runTime);
await page.waitForTimeout(400);
const stillPausedTime = await page.evaluate(() => window.vellum.state().runTime);
check('time stops while paused', Math.abs(stillPausedTime - pausedTime) < 0.001, `${pausedTime} -> ${stillPausedTime}`);
await page.keyboard.press('KeyP');
await page.waitForTimeout(150);
check('P resumes the run', (await page.evaluate(() => window.vellum.state().state)) === 'run');
await page.screenshot({ path: 'artifacts/flow-run.png' });

// Combat smoke: enter the first combat room and make sure the simulation runs.
await page.evaluate(() => window.vellum.takeExit(0));
await page.evaluate(() => window.vellum.advance(2));
const combat = await page.evaluate(() => window.vellum.state());
check('a combat room loads with enemies', combat.battle?.enemies.length > 0, `enemies ${combat.battle?.enemies.length}`);
// Locked doors show their gates. Two frames pass first so the view has synced the battle's lock state.
const gates = await page.evaluate(
  () =>
    new Promise((resolve) =>
      requestAnimationFrame(() =>
        requestAnimationFrame(() => {
          const isGate = (o) => o.geometry?.parameters?.width === 0.08 && o.geometry?.parameters?.height === 2.4;
          const room = window.vellum.app.world.currentRoom;
          resolve({
            locked: window.vellum.app.battle.grid.doorsLocked,
            visible: room.group.children.filter((o) => isGate(o) && o.visible).length,
          });
        }),
      ),
    ),
);
check('locked doors show their gates', gates.locked && gates.visible > 0, `locked ${gates.locked}, visible gates ${gates.visible}`);
// A hit shakes the view.
const frames = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
await page.evaluate(() => {
  const b = window.vellum.app.battle;
  b.hurtPlayer(5, b.player.x, b.player.z, 0);
});
await frames();
check('a hit shakes the view', (await page.evaluate(() => window.vellum.app.view.shakeLevel)) > 0);
// Overlay cells holding the arrow glyphs < > ^ v (atlas indices 28, 30, 62, 86).
const arrows = () =>
  page.evaluate(() => {
    const { cols, rows } = window.vellum.frameStats().grid;
    const data = window.vellum.app.ascii.overlay.data;
    const found = [];
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const i = (y * cols + x) * 4;
        if (data[i + 2] > 0 && [28, 30, 62, 86].includes(data[i])) found.push({ x, y });
      }
    }
    return { cols, found };
  });

// Finish the run as a loss, then restart and confirm the Quill is now unlocked.
await page.evaluate(() => window.vellum.finish(false));
await page.waitForTimeout(250);
check('the end screen appears after a finished run', (await page.evaluate(() => window.vellum.state().state)) === 'end');
await page.screenshot({ path: 'artifacts/flow-end.png' });
// Keyboard: Enter activates the focused button, so Title is reachable without the mouse.
await page.keyboard.press('ArrowDown');
await page.keyboard.press('Enter');
await page.waitForFunction(() => window.vellum.state().state === 'title', null, { timeout: 5000 }).catch(() => {});
check('Enter on Title returns to the title', (await page.evaluate(() => window.vellum.state().state)) === 'title');
await page.evaluate(() => window.vellum.startRun(11));
await page.evaluate(() => window.vellum.finish(false));
await page.waitForTimeout(250);
await page.getByRole('button', { name: /Restart run/ }).click();
await page.waitForTimeout(200);
check('restart begins a fresh run', (await page.evaluate(() => window.vellum.state().state)) === 'run');
check('restart starts again at the nave', (await page.evaluate(() => window.vellum.state().room?.kind)) === 'nave');
const unlocked = await page.evaluate(() => window.vellum.state().progress.unlocks.weapons);
check('finishing a run unlocks the Quill', unlocked.includes('quill'), JSON.stringify(unlocked));

// Reload: settings and progress persist.
await page.reload();
await page.waitForFunction(() => window.__ready === true, null, { timeout: 90000 });
const persisted = await page.evaluate(() => window.vellum.state().settings.contrast);
check('settings persist across a reload', Math.abs(persisted - 1.3) < 0.01, `contrast ${persisted}`);
const progress = await page.evaluate(() => window.vellum.state().progress);
check('progress persists across a reload', progress.runs >= 1, `runs ${progress.runs}`);

// Enter after a mouse click: the clicked toggle keeps its new value, so the browser did not click it again.
await page.getByRole('button', { name: 'Settings' }).click();
const hitStop = page.locator('.setting', { has: page.locator('.name', { hasText: 'Hit-stop' }) }).locator('button.toggle');
await hitStop.click();
const clicked = await page.evaluate(() => window.vellum.state().settings.hitStop);
await page.keyboard.press('Enter');
await page.waitForTimeout(600);
const afterEnter = await page.evaluate(() => window.vellum.state().settings.hitStop);
check('Enter after a click leaves the clicked setting alone', afterEnter === clicked, `clicked ${clicked}, after Enter ${afterEnter}`);

// An enemy hunting from behind the player gets a marker on its own side. The nave holds no other enemies,
// so every marker is this one. The player moves to the middle of the room, where the floor is open.
await page.evaluate(() => window.vellum.startRun(42));
await page.evaluate(() => {
  const app = window.vellum.app;
  const b = app.battle;
  const yaw = app.view.yaw;
  b.player.x = Math.floor(b.layout.w / 2) + 0.5;
  b.player.z = Math.floor(b.layout.h / 2) + 0.5;
  b.addEnemy('husk', b.player.x + 4 * Math.sin(yaw) + 2 * Math.cos(yaw), b.player.z + 4 * Math.cos(yaw) - 2 * Math.sin(yaw));
});
await page.evaluate(() => window.vellum.advance(1.2));
await frames();
const markers = await arrows();
check('a marker for an enemy behind the player sits on its side', markers.found.some((p) => p.x > markers.cols / 2), JSON.stringify(markers.found));

check('no console errors or page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, total: results.length }));
await browser.close();
