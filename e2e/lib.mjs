import { chromium } from 'playwright-core';

/** Launches the pre-installed Chromium with software WebGL2 (no GPU in CI or sandboxes). */
export async function launchBrowser() {
  return chromium.launch({
    executablePath: process.env.CHROME_PATH ?? '/opt/pw-browsers/chromium',
    headless: true,
    args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
}

/** Collects console errors and page exceptions so tests can assert on a clean run. */
export function collectErrors(page) {
  const errors = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`[${m.type()}] ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`));
  return errors;
}
