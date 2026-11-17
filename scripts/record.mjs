// Records the board in use and prints the moments of the recording as JSON.
//   node scripts/record.mjs <board url> [--dry] [--out <dir>]
// The flow: open the board, watch a new incident arrive, aim at Ack on the top row, wait for the next
// incident, then click where the pointer already is. --dry does everything but the click.
// The recorder adds two things to the page that the board does not have: a pointer dot and a clock.
import { mkdirSync, renameSync } from 'node:fs';
import { chromium } from 'playwright';

const args = process.argv.slice(2);
const url = args.find((arg) => arg.startsWith('http'));
const dry = args.includes('--dry');
const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : 'recording';
if (!url) throw new Error('usage: node scripts/record.mjs <board url> [--dry] [--out <dir>]');
mkdirSync(out, { recursive: true });

const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, recordVideo: { dir: out, size: { width: 1280, height: 720 } } });
const started = Date.now(); // the recording starts with the page
const page = await context.newPage();
const at = () => {
  const s = Math.round((Date.now() - started) / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

await page.addInitScript((startedAt) => {
  addEventListener('DOMContentLoaded', () => {
    const dot = document.createElement('div');
    dot.style.cssText = 'position:fixed;z-index:9;width:14px;height:14px;margin:-7px 0 0 -7px;border-radius:50%;background:rgba(220,0,60,.8);pointer-events:none;left:-20px;top:-20px';
    const clock = document.createElement('div');
    clock.style.cssText = 'position:fixed;z-index:9;right:12px;top:12px;padding:4px 10px;font:600 20px ui-monospace,monospace;background:#111;color:#fff;border-radius:6px;pointer-events:none';
    document.body.append(dot, clock);
    addEventListener('mousemove', (e) => { dot.style.left = `${e.clientX}px`; dot.style.top = `${e.clientY}px`; }, true);
    addEventListener('mousedown', () => { dot.style.outline = '6px solid rgba(220,0,60,.35)'; setTimeout(() => (dot.style.outline = ''), 400); }, true);
    const tick = () => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      clock.textContent = `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
      requestAnimationFrame(tick);
    };
    tick();
  });
}, started);

const moments = { url, dry, startedAt: new Date(started).toISOString(), events: [] };
const note = (what, more = {}) => { moments.events.push({ at: at(), utc: new Date().toISOString(), what, ...more }); };
page.on('console', (message) => {
  if (message.type() !== 'info' || !message.text().startsWith('ack ')) return;
  const [, id, ackedAt, receipt] = message.text().split(' ');
  note('ack answered', { id, ackedAt, receipt });
});

const topId = () => page.locator('[data-testid="incident-row"]').first().getAttribute('data-id');
const idUnder = (x, y) => page.evaluate(([px, py]) => document.elementFromPoint(px, py)?.closest('[data-testid="incident-row"]')?.dataset.id ?? null, [x, y]);
const newTop = (old) => page.waitForFunction((id) => document.querySelector('[data-testid="incident-row"]')?.dataset.id !== id, old, { timeout: 60000 });

await page.goto(url);
note('page opened', { loader: await page.locator('[data-testid="loader"]').count() });
await page.locator('[data-testid="incident-row"]').first().waitFor();
moments.sha = await page.locator('meta[name="build"]').getAttribute('content');
moments.footerSha = await page.locator('[data-testid="build-sha"]').textContent();
const first = await topId();
note('incidents on screen', { top: first, rows: await page.locator('[data-testid="incident-row"]').count() });

await newTop(first);
const target = await topId();
note('new incident arrived at the top, no reload', { top: target });
await page.waitForTimeout(1200);

// Aim at Ack on the top row, as on-call would.
const box = await page.locator(`[data-testid="incident-row"][data-id="${target}"] [data-testid="ack"]`).boundingBox();
const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
await page.mouse.move(x - 300, y + 200);
await page.mouse.move(x, y, { steps: 25 });
note('pointer on Ack', { aimedAt: await idUnder(x, y) });

await newTop(target);
const under = await idUnder(x, y);
note('a newer incident arrived while the pointer was on Ack', { aimedAt: target, nowUnderPointer: under });
if (!dry) {
  await page.mouse.click(x, y);
  note('click, pointer not moved', { aimedAt: target, clicked: under });
  await page.locator('[data-testid="acked"]').first().waitFor();
  note('acked mark on screen', { row: await page.locator('[data-testid="incident-row"]:has([data-testid="acked"])').first().getAttribute('data-id') });
}
await page.waitForTimeout(5000);
note('end', { rows: await page.locator('[data-testid="incident-row"]').count() });

const video = page.video();
await context.close();
const file = `${out}/board-${(moments.sha ?? 'dev').slice(0, 7)}${dry ? '-dry' : ''}.webm`;
renameSync(await video.path(), file);
await browser.close();
moments.file = file;
console.log(JSON.stringify(moments, null, 2));
