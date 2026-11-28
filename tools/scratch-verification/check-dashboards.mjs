// ORNL's /dashboards workspace opens, and a browser that still holds dashboards saved by our
// old (pre-3.12, schema-4 "editable main pages") viewer loads ORNL's viewer without errors.
// Only touches its own fresh browser context; nothing on the server changes.
//
//   On a node still running our old viewer (e.g. the rehearsal baseline), capture a real saved
//   state, including one user-made dashboard:
//     MODE=capture OUT=/path/old-state.json OSCAR_BASE=https://<host> PW_FILE=<pw> node check-dashboards.mjs
//   On the upgraded node, replay it (SEED is optional; without it only the smoke check runs):
//     MODE=check SEED=/path/old-state.json OSCAR_BASE=https://<host> PW_FILE=<pw> node check-dashboards.mjs
import fs from 'node:fs';
import { open, sleep, BASE } from './harness.mjs';

const mode = process.env.MODE ?? 'check';
const failures = [];
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) failures.push(msg); };
// Noise that is not an app error (self-signed TLS, service worker, missing retained media).
const noise = /SSL certificate|Service ?Worker|useResizeContainer|Failed to load resource: the server responded with a status of 404/i;

if (mode === 'capture') {
  const { browser, page } = await open();
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await sleep(8000);                                // let the old viewer seed its main pages
  // Add one user-made dashboard the way an operator would, if the old UI offers it.
  if (await page.locator('[data-testid="add-page-button"]').isVisible().catch(() => false)) {
    await page.click('[data-testid="add-page-button"]');
    await page.getByLabel('Page name').fill('Operator wall');
    await page.getByRole('button', { name: /create/i }).click();
    await sleep(3000);
  }
  const state = await page.evaluate(() => localStorage.getItem('persist:root'));
  if (!state || !state.includes('pageLayoutSlice')) throw new Error('no saved dashboard state found; is this the old viewer?');
  fs.writeFileSync(process.env.OUT, state, { mode: 0o600 });
  console.log(`captured ${state.length} bytes of persist:root to ${process.env.OUT}`);
  await browser.close();
  process.exit(0);
}

const { browser, context, page, errors } = await open();
if (process.env.SEED) {
  const seed = fs.readFileSync(process.env.SEED, 'utf8');
  check(seed.includes('schemaVersion'), 'seed holds an old saved page layout');
  // Put the old state back before any viewer script runs, as a returning operator's browser would have it.
  await context.addInitScript(s => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('persist:root', s); sessionStorage.setItem('seeded', '1'); } }, seed);
  errors.length = 0;
}
for (const path of ['/', '/map/', '/event-log/', '/dashboards/']) {
  await page.goto(BASE + path, { waitUntil: 'domcontentloaded' });
  await sleep(4000);
}
check(await page.locator('[data-testid="custom-dashboards-page"]').isVisible().catch(() => false), '/dashboards renders');
check(await page.locator('[data-testid="dashboards-templates-button"], [data-testid="dashboards-new-page-button"]').first().isVisible().catch(() => false), '/dashboards offers templates or a new dashboard');
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid^="lane-health-card-"]', { timeout: 30000 }).catch(() => {});
check(await page.locator('[data-testid^="lane-health-card-"]').count() > 0, "home is ORNL's Dashboard with lane cards");
const appErrors = errors.filter(e => !noise.test(e));
check(appErrors.length === 0, 'no page errors ' + JSON.stringify(appErrors.slice(0, 3)));
console.log(failures.length ? `DASHBOARDS CHECK FAILED (${failures.length})` : 'DASHBOARDS CHECK PASSED');
await browser.close();
process.exit(failures.length ? 1 : 0);
