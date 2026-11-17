// Checks the plan's requirements (R1-R6) against the built board, with the incident API mocked.
// Run: npm run build && npm test
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { chromium } from 'playwright';
import { serve } from './serve.mjs';

const { server, url } = await serve();
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || undefined });
const tid = (id) => `[data-testid="${id}"]`;
const incident = (id, openedAt, summary = 'cancel button times out') => ({ id, service: 'booking-api', region: 'eu-west', summary, severity: 'sev2', openedAt });

/** Opens the board against a mocked API. `state.incidents` is what the API answers now. */
async function open({ locale = 'en-US', timezoneId = 'UTC', incidents = [], delay = 0 } = {}) {
  const context = await browser.newContext({ locale, timezoneId });
  const page = await context.newPage();
  const state = { incidents, polls: 0, acks: [] };
  await page.route('**/api/incidents*', async (route) => {
    state.polls += 1;
    if (delay) await new Promise((r) => setTimeout(r, delay));
    await route.fulfill({ json: { updatedAt: new Date().toISOString(), incidents: state.incidents, cursor: `c${state.polls}` } });
  });
  await page.route('**/api/ack*', async (route) => {
    const q = new URL(route.request().url()).searchParams;
    state.acks.push({ id: q.get('id'), cursor: q.get('cursor') });
    await route.fulfill({ json: { id: q.get('id'), ackedAt: '2026-11-12T03:05:00.000Z', receipt: 'r-test' } });
  });
  await page.goto(url);
  return { page, state, close: () => context.close() };
}

const ids = (page) => page.locator(tid('incident-row')).evaluateAll((rows) => rows.map((row) => row.dataset.id));
const results = [];
async function check(name, fn) {
  try {
    await fn();
    results.push(['ok', name]);
  } catch (cause) {
    results.push(['FAIL', `${name}\n     ${cause.message.split('\n')[0]}`]);
  }
}

const A = incident('INC-1', '2026-11-12T03:03:00.000Z');
const B = incident('INC-2', '2026-11-12T03:10:00.000Z');
const C = incident('INC-3', '2026-11-12T03:20:00.000Z');

await check('R3 loader shows on open and is gone once incidents are on screen', async () => {
  const { page, close } = await open({ incidents: [B, A], delay: 800 });
  await page.locator(tid('loader')).waitFor({ state: 'visible', timeout: 700 });
  await page.locator(tid('incident-row')).first().waitFor();
  assert.equal(await page.locator(tid('loader')).count(), 0);
  await close();
});

await check('R1+R4 a new incident shows at the top within one refresh, with no reload', async () => {
  const { page, state, close } = await open({ incidents: [B, A] });
  await page.locator(tid('incident-row')).first().waitFor();
  assert.deepEqual(await ids(page), ['INC-2', 'INC-1']);
  await page.locator(`${tid('incident-row')}[data-id="INC-2"]`).evaluate((row) => (row.dataset.kept = 'yes'));
  state.incidents = [C, B, A];
  await page.locator(`${tid('incident-row')}[data-id="INC-3"]`).waitFor({ timeout: 2600 });
  assert.deepEqual(await ids(page), ['INC-3', 'INC-2', 'INC-1']);
  assert.equal(await page.locator('[data-kept="yes"]').count(), 1, 'a refresh must not rebuild rows');
  const before = state.polls;
  await page.waitForTimeout(4200);
  assert.ok(state.polls - before >= 2 && state.polls - before <= 3, `polls in 4.2 s: ${state.polls - before}`);
  await close();
});

await check('R2 Ack on a row acks that incident with the latest cursor and marks the row', async () => {
  const { page, state, close } = await open({ incidents: [B, A] });
  const row = page.locator(`${tid('incident-row')}[data-id="INC-1"]`);
  await row.locator(tid('ack')).click();
  await row.locator(tid('acked')).waitFor();
  assert.equal(state.acks.length, 1);
  assert.equal(state.acks[0].id, 'INC-1');
  assert.equal(state.acks[0].cursor, `c${state.polls}`);
  assert.equal(await row.locator(tid('ack')).count(), 0);
  assert.equal(await page.locator(tid('ack')).count(), 1, 'the other row keeps its Ack button');
  state.incidents = [C, B, A];
  await page.locator(`${tid('incident-row')}[data-id="INC-3"]`).waitFor();
  assert.equal(await row.locator(tid('acked')).count(), 1, 'the acked mark must survive a refresh');
  await close();
});

for (const [locale, timezoneId, want] of [
  ['de-DE', 'Europe/Berlin', /^12\.11\.2026, 04:03:00 (MEZ|GMT\+1)$/],
  ['en-NZ', 'Pacific/Auckland', /^12\/11\/2026, 04:03:00 pm (NZDT|GMT\+13)$/],
  ['en-US', 'America/New_York', /^11\/11\/2026, 10:03:00 PM (EST|GMT-5)$/],
]) {
  await check(`R5 ${locale} in ${timezoneId} sees its own zone and order`, async () => {
    const { page, close } = await open({ locale, timezoneId, incidents: [A] });
    const time = page.locator(`${tid('incident-row')} time`).first();
    assert.match((await time.textContent()).replace(/ /g, ' '), want);
    assert.equal(await time.getAttribute('datetime'), '2026-11-12T03:03:00.000Z');
    await close();
  });
}

await check('empty hook shows with no incidents and goes when one arrives', async () => {
  const { page, state, close } = await open({ incidents: [] });
  await page.locator(tid('empty')).waitFor();
  assert.equal(await page.locator(tid('loader')).count(), 0);
  state.incidents = [A];
  await page.locator(tid('incident-row')).waitFor();
  assert.equal(await page.locator(tid('empty')).count(), 0);
  await close();
});

await check('a summary with markup is shown as text', async () => {
  const { page, close } = await open({ incidents: [incident('INC-9', A.openedAt, '<img src=x onerror="document.title=1">')] });
  await page.locator(tid('incident-row')).waitFor();
  assert.equal(await page.locator(`${tid('incident-row')} img`).count(), 0);
  await close();
});

await check('R6 meta build and footer name the git sha', async () => {
  const { page, close } = await open({ incidents: [A] });
  const sha = execSync('git rev-parse HEAD').toString().trim();
  assert.equal(await page.locator('meta[name="build"]').getAttribute('content'), sha);
  assert.equal(await page.locator(tid('build-sha')).textContent(), sha);
  await close();
});

await browser.close();
server.close();
for (const [state, name] of results) console.log(`${state.padEnd(4)} ${name}`);
process.exit(results.some(([state]) => state === 'FAIL') ? 1 : 0);
