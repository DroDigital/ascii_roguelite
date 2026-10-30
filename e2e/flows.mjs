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

// Finish the run as a loss, then restart and confirm the Quill is now unlocked.
await page.evaluate(() => window.vellum.finish(false));
await page.waitForTimeout(250);
check('the end screen appears after a finished run', (await page.evaluate(() => window.vellum.state().state)) === 'end');
await page.screenshot({ path: 'artifacts/flow-end.png' });
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

check('no console errors or page exceptions', errors.length === 0, errors.slice(0, 3).join(' | '));
for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.detail ? `  (${r.detail})` : ''}`);
console.log(JSON.stringify({ passed: results.filter((r) => r.ok).length, total: results.length }));
await browser.close();
