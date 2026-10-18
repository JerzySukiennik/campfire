import { chromium } from '/Users/jurek/Downloads/Claude/Projects/SatisFarm/node_modules/playwright-core/index.mjs';
const out = '/private/tmp/claude-501/-Users-jurek-Downloads-Claude-Projects/b5cbb280-ecbe-46e7-a861-12832fa0c841/scratchpad';
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--ignore-gpu-blocklist', '--use-angle=metal'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errs = [];
page.on('pageerror', (e) => errs.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 200)); });
await page.goto('http://127.0.0.1:8771/?auto&fixed');
await page.waitForFunction(() => window.__campfire, null, { timeout: 90000 });
await page.waitForTimeout(3000);
const proj = (x, y, z) => page.evaluate(([x, y, z]) => { const c = __campfire; const v = new c.camera.position.constructor(x, y, z).project(c.camera); return [Math.round((v.x * 0.5 + 0.5) * innerWidth), Math.round((-v.y * 0.5 + 0.5) * innerHeight)]; }, [x, y, z]);
const state = () => page.evaluate(() => { const c = __campfire; return { n: c.logs.logs.length, I: +c.logs.intensity.toFixed(2), coal: +c.logs.coal.heat.toFixed(2), wet: +c.logs.coal.wet.toFixed(2), sparks: c.interaction.particles.sparks.count, smoke: c.interaction.particles.smoke.p.length, status: document.querySelector('#status').textContent, flash: document.querySelector('#flash').textContent }; });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
console.log('start', JSON.stringify(await state()));

const [fx, fy] = await proj(0, 0.15, 0);
await page.mouse.click(fx, fy);
await page.waitForTimeout(250);
console.log('poke', JSON.stringify(await state()));
await shot('t_poke');

const lp = await page.evaluate(() => { const l = __campfire.logs.logs[0]; return [l.c.x, l.c.y, l.c.z, l.id]; });
const [lx, ly] = await proj(lp[0], lp[1] + 0.02, lp[2]);
await page.mouse.move(lx, ly); await page.mouse.down();
for (let i = 1; i <= 20; i++) { await page.mouse.move(lx + i * 14, ly + i * 6); await page.waitForTimeout(30); }
await page.waitForTimeout(400);
await shot('t_drag_hold');
await page.mouse.up();
await page.waitForTimeout(1500);
const lp2 = await page.evaluate((id) => { const l = __campfire.logs.logs.find((q) => q.id === id); return l ? [l.c.x, l.c.y, l.c.z].map((v) => +v.toFixed(2)) : null; }, lp[3]);
console.log('drag', lp.slice(0, 3).map((v) => +v.toFixed(2)), '->', lp2);

await page.keyboard.press('2');
await page.mouse.move(fx, fy - 60); await page.mouse.down();
await page.mouse.move(fx + 5, fy - 50); await page.waitForTimeout(500);
await page.mouse.move(fx, fy); await page.waitForTimeout(300);
await page.mouse.up();
await page.waitForTimeout(2500);
console.log('addlog', JSON.stringify(await state()));
await shot('t_addlog');

await page.keyboard.press('3');
await page.mouse.move(fx, fy); await page.mouse.down();
for (let i = 0; i < 12; i++) { await page.mouse.move(fx + Math.sin(i) * 30, fy + Math.cos(i) * 10); await page.waitForTimeout(120); }
await shot('t_pour');
console.log('pouring', JSON.stringify(await state()));
await page.mouse.up();
await page.waitForTimeout(2500);
console.log('after water', JSON.stringify(await state()));
await shot('t_after_water');

await page.keyboard.press('4');
await page.mouse.click(fx, fy);
await page.waitForTimeout(500);
console.log('match', JSON.stringify(await state()));

await page.keyboard.press('5');
await page.mouse.move(fx, fy - 120);
await page.waitForTimeout(500);
for (let i = 0; i < 10; i++) { await page.mouse.move(fx + i, fy - 150); await page.waitForTimeout(300); }
console.log('marsh', JSON.stringify(await state()));
await shot('t_marsh');
await page.keyboard.press('e');
await page.waitForTimeout(300);
console.log('eat', JSON.stringify(await state()));
console.log('errors', errs);
await browser.close();
