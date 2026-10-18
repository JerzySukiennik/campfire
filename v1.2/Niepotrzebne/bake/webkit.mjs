import { webkit, devices } from '/Users/jurek/Downloads/Claude/Projects/Gzowo-Reel/node_modules/playwright-core/index.mjs';
const out = '/private/tmp/claude-501/-Users-jurek-Downloads-Claude-Projects/b5cbb280-ecbe-46e7-a861-12832fa0c841/scratchpad';
const browser = await webkit.launch({ headless: true });
const ctx = await browser.newContext({ ...devices['iPhone 12'] });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push('[err] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push('[' + m.type() + '] ' + m.text().slice(0, 300)); });
await page.goto('http://127.0.0.1:8771/?auto&debug', { waitUntil: 'commit', timeout: 60000 });
try { await page.waitForFunction(() => window.__campfire, null, { timeout: 150000 }); } catch (e) { logs.push('timeout waiting for app'); }
await page.waitForTimeout(6000);
await page.screenshot({ path: `${out}/wk_iphone.png` });
const info = await page.evaluate(() => { const c = window.__campfire; if (!c) return document.querySelector('#loadlabel')?.textContent; return { w: c.pipeline.w, h: c.pipeline.h, fx: c.pipeline.fxRT.width, msaa: c.pipeline.msaa, gpu: document.querySelector('div[style*=monospace]')?.textContent }; });
console.log(JSON.stringify(info));
console.log(logs.filter((l) => !l.includes('Clock')).slice(0, 15).join('\n'));
await browser.close();
