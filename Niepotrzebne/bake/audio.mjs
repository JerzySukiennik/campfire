import { chromium, webkit } from '/Users/jurek/Downloads/Claude/Projects/Gzowo-Reel/node_modules/playwright-core/index.mjs';
for (const [name, bt, opts] of [['chrome', chromium, { channel: 'chrome', headless: true, args: ['--autoplay-policy=no-user-gesture-required'] }], ['webkit', webkit, { headless: true }]]) {
  let browser;
  try { browser = await bt.launch(opts); } catch (e) { console.log(name, 'launch failed', e.message.slice(0, 100)); continue; }
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message));
  page.on('console', (m) => { if ((m.type() === 'error' || m.type() === 'warning') && !m.text().includes('Clock') && !m.text().includes('404')) errs.push(m.text().slice(0, 200)); });
  await page.goto('http://127.0.0.1:8771/', { waitUntil: 'commit' });
  await page.waitForFunction(() => document.querySelector('#intro.show'), null, { timeout: 120000 });
  await page.mouse.click(640, 400);
  await page.waitForTimeout(6000);
  const st = await page.evaluate(() => { const a = __campfire.interaction.audio; return { state: a.ctx?.state, ready: a.ready, buffers: Object.keys(a.buffers), fire: a.fireGain?.gain.value.toFixed(3), night: a.nightGain?.gain.value.toFixed(3), master: a.master?.gain.value.toFixed(3), loops: a.loops?.length }; });
  console.log(name, JSON.stringify(st), errs);
  await browser.close();
}
