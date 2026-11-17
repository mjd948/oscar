// Phase 4 acceptance for the 3.11 cutover (LIVE_UPGRADE_PLAN.md). Read-only: it signs in, reads
// the dashboard, opens each portal lane's live video and the map. It adjudicates nothing.
//   OSCAR_BASE=https://<host> PW_FILE=<admin pw file> LANES="Marshall,AFM Gate,Selfridge,Memorial Ave" MOBILE="Patrol 1" node acceptance.mjs
// Run from a directory with playwright installed, next to ../scratch-verification/harness.mjs.
import { open, sleep, laneStates, BASE } from './harness.mjs';
const portal = (process.env.LANES ?? 'Marshall,AFM Gate,Selfridge,Memorial Ave').split(',');
const mobile = (process.env.MOBILE ?? 'Patrol 1').split(',').filter(Boolean);
const { browser, page, errors } = await open();
const failures = [];
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) failures.push(msg); };

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
let s = {};
for (let i = 0; i < 24; i++) {          // up to 2 min for every lane to report
  await sleep(5000);
  s = await laneStates(page);
  const all = [...portal, ...mobile].every(l => s[`${l}-rpm`] === 'online') && portal.every(l => s[`${l}-camera`] === 'online');
  if (all) break;
}
for (const l of portal) check(s[`${l}-rpm`] === 'online' && s[`${l}-camera`] === 'online', `${l}: RPM ${s[`${l}-rpm`]}, camera ${s[`${l}-camera`]}`);
for (const l of mobile) {
  check(s[`${l}-rpm`] === 'online', `${l}: detector ${s[`${l}-rpm`]}`);
  check(!Object.keys(s).some(k => k.startsWith(`${l}-`) && /gamma|neutron|tamper|extended/.test(k)), `${l}: no portal-fault indicators`);
}

for (const l of portal) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.click(`[data-testid="lane-health-card-${l}"]`);
  await page.waitForURL(u => u.pathname.startsWith('/lane-view'), { timeout: 20000 });
  let v = [];
  for (let i = 0; i < 20; i++) {
    await sleep(1000);
    v = await page.$$eval('video', vs => vs.map(x => ({ t: x.currentTime, w: x.videoWidth })));
    if (v.some(x => x.t > 1 && x.w > 0)) break;
  }
  check(v.some(x => x.t > 1 && x.w > 0), `${l}: live video plays ${JSON.stringify(v.map(x => [+x.t.toFixed(1), x.w]))}`);
}

if (mobile.length) {
  await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.mobile-unit-marker', { timeout: 60000 }).catch(() => {});
  const pos = () => page.$$eval('.mobile-unit-marker', els => els.map(e => e.style.transform));
  const a = await pos(); await sleep(20000); const b = await pos();
  check(a.length === mobile.length && a.some((t, i) => t !== b[i]), `map: ${a.length} walker marker(s), moving`);
}

const appErrors = errors.filter(e => !/SSL certificate|Service ?Worker|useResizeContainer/i.test(e));
check(appErrors.length === 0, 'no page errors ' + JSON.stringify(appErrors.slice(0, 3)));
console.log(failures.length ? `ACCEPTANCE FAILED (${failures.length})` : 'ACCEPTANCE PASSED');
await browser.close();
process.exit(failures.length ? 1 : 0);
