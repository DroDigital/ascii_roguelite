import { launchBrowser, collectErrors } from './lib.mjs';

// Usage: node e2e/topdown.mjs <query> <out.png>
const [query = 'seed=42', out = 'artifacts/topdown.png'] = process.argv.slice(2);
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
const errors = collectErrors(page);
await page.goto(`http://127.0.0.1:5173/?test=1&${query}`);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 60000 });
await page.evaluate(() => window.vellum.setTopDown(true));
await page.waitForTimeout(1200);
await page.screenshot({ path: out });
console.log(JSON.stringify({ out, errors }, null, 2));
await browser.close();
