import { chromium } from '/Users/jurek/Downloads/Claude/Projects/SatisFarm/node_modules/playwright-core/index.mjs';
const out = process.env.OUT || '/private/tmp/claude-501/-Users-jurek-Downloads-Claude-Projects/b5cbb280-ecbe-46e7-a861-12832fa0c841/scratchpad';
const W = +(process.env.W || 1280), H = +(process.env.H || 800);
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=metal', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[err]', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('[' + m.type() + ']', m.text().slice(0, 300)); });
const shots = process.argv.slice(3);
await page.goto('http://localhost:8771/' + process.argv[2]);
await page.waitForFunction(() => window.__campfire, null, { timeout: 90000 });
await page.waitForTimeout(+(process.env.WAIT || 3000));
let i = 0;
for (const s of shots) {
  const [name, code, wait] = s.split('|');
  if (code) await page.evaluate(code);
  await page.waitForTimeout(+(wait || 1200));
  await page.screenshot({ path: `${out}/${name}.png` });
  console.log('shot', name);
}
await browser.close();
