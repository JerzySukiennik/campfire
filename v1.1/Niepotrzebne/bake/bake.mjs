import { chromium } from '/Users/jurek/Downloads/Claude/Projects/SatisFarm/node_modules/playwright-core/index.mjs';
import { writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
const OUT = new URL('../../tex/', import.meta.url).pathname;
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await browser.newPage();
page.on('console', (m) => console.log('[page]', m.text()));
await page.goto('http://localhost:8771/Niepotrzebne/bake/bake.html');
await page.waitForFunction(() => window.ready === true);
const res = await page.evaluate(() => window.bake());
await browser.close();
const tmp = new URL('./tmp/', import.meta.url).pathname;
execFileSync('mkdir', ['-p', tmp]);
for (const [k, v] of Object.entries(res)) {
  if (k === 'noise') { writeFileSync(OUT + 'noise.bin', Buffer.from(v, 'base64')); continue; }
  const buf = Buffer.from(v.split(',')[1], 'base64');
  const p = tmp + k + '.png';
  writeFileSync(p, buf);
  const normal = k.endsWith('_n');
  const args = normal ? ['-near_lossless', '40', '-m', '6', '-quiet', p, '-o', OUT + k + '.webp'] : ['-q', k === 'grass' ? '92' : '88', '-m', '6', '-quiet', p, '-o', OUT + k + '.webp'];
  execFileSync('cwebp', args);
}
console.log('baked', Object.keys(res).join(', '));
