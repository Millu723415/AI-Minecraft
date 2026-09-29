// Dev helper: create a world through the real UI flow, play scripted actions, screenshot.
// Usage: node scripts/play.mjs <out-prefix> [seed] [steps-json]
import { chromium } from 'playwright';

const [prefix, seed = '12345', stepsArg = '[]'] = process.argv.slice(2);
const steps = JSON.parse(stepsArg);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const logs = [];
page.on('console', (m) => { if (m.type() !== 'debug') logs.push(`[${m.type()}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack}`));
await page.goto('http://localhost:5173/');
await page.waitForTimeout(2500);
await page.evaluate((s) => window.app.createWorld('Test', s, 'survival', 2), seed);
// Wait for loading to finish.
for (let i = 0; i < 90; i++) {
  await page.waitForTimeout(1000);
  const st = await page.evaluate(() => window.app.game?.state);
  if (st === 'playing') break;
}
let shot = 0;
for (const step of steps) {
  if (step.eval) {
    const r = await page.evaluate(step.eval);
    if (r !== undefined) console.log('eval:', typeof r === 'string' ? r : JSON.stringify(r));
  }
  if (step.wait) await page.waitForTimeout(step.wait);
  if (step.shot) await page.screenshot({ path: `${prefix}-${shot++}.png` });
}
await page.screenshot({ path: `${prefix}-final.png` });
console.log(logs.slice(-30).join('\n'));
await browser.close();
