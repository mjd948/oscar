// Event Log checks for 3.11.11 (read-only, safe on live): Event Log sort toggle, CQL offset probe, paging forward and back,
// and no HTTP 5xx from /sensorhub/api/observations. Lifted from ORNL's
// tools/test-live-deployment-regression.sh step 7b, plus a paging round trip.
import { open, sleep, BASE } from './harness.mjs';
const { browser, context, page, errors } = await open();
const failures = [];
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) failures.push(msg); };
const obs5xx = [];
let obsRequests = 0;
page.on('response', r => {
  if (r.url().includes('/sensorhub/api/observations')) {
    obsRequests++;
    if (r.status() >= 500) obs5xx.push(`${r.status()} ${r.url().slice(0, 160)}`);
  }
});

await page.goto(BASE + '/event-log', { waitUntil: 'domcontentloaded' });
console.log('event log opened at', page.url());
const toggle = page.getByTestId('toolbar-sort-time-only').first();
await toggle.waitFor({ state: 'visible', timeout: 30000 });
const before = await toggle.getAttribute('aria-pressed');
await toggle.click();
await sleep(1500);
const after = await toggle.getAttribute('aria-pressed');
check(before !== after && (after === 'true' || after === 'false'), `Newest-first toggle flips aria-pressed ${before} -> ${after}`);
if (after === 'true') { await toggle.click(); await sleep(1500); }

const probe = await context.request.get(BASE + '/sensorhub/api/observations?filter='
  + encodeURIComponent('gammaAlarm=true AND neutronAlarm=false') + '&order=desc&offset=45&limit=15',
  { headers: { Accept: 'application/om+json' } });
check(probe.status() === 200, `offset CQL observation query returns ${probe.status()}`);

// Paging round trip: next, next, previous, previous. Visited pages should come back quickly.
const next = page.getByRole('button', { name: /next page/i }).first();
const prev = page.getByRole('button', { name: /previous page/i }).first();
const firstRow = async () => (await page.locator('.MuiDataGrid-row').first().textContent().catch(() => '')) ?? '';
await sleep(3000);
if (await next.isEnabled().catch(() => false)) {
  const p0 = await firstRow();
  await next.click(); await sleep(2500); const p1 = await firstRow();
  const canSecond = await next.isEnabled().catch(() => false);
  if (canSecond) { await next.click(); await sleep(2500); }
  const reqBeforeBack = obsRequests;
  const t0 = Date.now();
  if (canSecond) { await prev.click(); await page.waitForFunction(r => document.querySelector('.MuiDataGrid-row')?.textContent === r, p1, { timeout: 10000 }).catch(() => {}); }
  const back1Ms = Date.now() - t0;
  const p1again = await firstRow();
  await prev.click(); await sleep(1500);
  const p0again = await firstRow();
  check(p1 !== p0, 'page 2 shows different rows from page 1');
  if (canSecond) {
    check(p1again === p1, `back to page 2 shows the same rows (${back1Ms} ms, ${obsRequests - reqBeforeBack} observation requests during back-navigation)`);
  }
  check(p0again.length > 0, 'page 1 has rows after paging back');
} else {
  console.log('SKIP paging round trip: fewer than two pages of events');
}

check(obs5xx.length === 0, `no HTTP 5xx on observation requests (${obsRequests} seen) ${JSON.stringify(obs5xx.slice(0, 3))}`);
const realErrors = errors.filter(e => !/SSL certificate|Service ?Worker|useResizeContainer|webauthn\/options/i.test(e));
check(realErrors.length === 0, `no page errors ${JSON.stringify(realErrors.slice(0, 3))}`);
await browser.close();
console.log(failures.length ? `EVENT LOG CHECK FAILED (${failures.length})` : 'EVENT LOG CHECK PASSED');
process.exit(failures.length ? 1 : 0);
