import { launchBrowser, collectErrors } from './lib.mjs';

// Usage: node e2e/shot.mjs <url> <out.png> [waitMs]
const [url = 'http://127.0.0.1:5173/?test=1', out = 'artifacts/shot.png', waitMs = '1500'] = process.argv.slice(2);
const width = Number(process.env.W ?? 1280);
const height = Number(process.env.H ?? 720);

const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
const errors = collectErrors(page);
await page.goto(url);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.waitForTimeout(Number(waitMs));
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
