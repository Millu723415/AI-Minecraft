// Dev helper: open the game in headless Chromium and save a screenshot.
// Usage: node scripts/shot.mjs <url> <out.png> [waitMs] [js-to-eval-before-shot]
import { chromium } from 'playwright';

const [url, out, waitMs = '8000', evalJs = ''] = process.argv.slice(2);
const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto(url);
await page.waitForTimeout(Number(waitMs));
if (evalJs) {
  try {
    const r = await page.evaluate(evalJs);
    if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r));
  } catch (e) { console.log('eval error', e.message); }
  await page.waitForTimeout(1500);
}
await page.screenshot({ path: out });
console.log(logs.slice(-40).join('\n'));
await browser.close();
