// Editable main pages: every main sidebar entry, a typed ORNL address and a lane click open the
// built-in editable widget page; Lane View picks the RS-350 layout for RS-350 lanes; edits survive
// a reload and Reset restores the layout; main pages cannot be deleted; the switch hands back to
// ORNL's original pages and forth.
//   OSCAR_BASE=https://<host> PW_FILE=<admin pw file> [RS350_LANE="Patrol 1"|""] [PORTAL_LANE=Marshall] node check-main-pages.mjs
import { open, sleep, BASE } from './harness.mjs';
const { browser, page, errors } = await open();
const fail = [];
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail.push(msg); };
const RS350_LANE = process.env.RS350_LANE ?? 'Patrol 1';
const PORTAL_LANE = process.env.PORTAL_LANE ?? 'Marshall';
const notFound = [];
page.on('response', r => { if (r.status() === 404) notFound.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
const pageId = () => new URL(page.url()).searchParams.get('id');
const path = () => new URL(page.url()).pathname.replace(/\/+$/, '') || '/';
const waitForPage = (id) => page.waitForURL(u => u.searchParams.get('id') === id, { timeout: 30000 }).then(() => true, () => false);
async function drawer() {
  await page.getByLabel('open drawer').or(page.locator('button[aria-label="Open drawer"]')).first().click().catch(() => {});
}
async function nav(testId) {
  await drawer();
  await page.locator(`[data-testid="${testId}"]`).first().click();
}

// 1. Landing on / opens the editable dashboard.
check(await waitForPage('main-dashboard'), 'opening the site lands on the editable Dashboard');
await page.waitForSelector('[data-testid="widget-system-status"]', { timeout: 30000 });
check(await page.locator('[data-testid="edit-mode-toggle"]').count() === 1, 'Dashboard has Edit Layout');
check((await page.locator('[data-testid="page-header-slot"]').innerText()).includes('Dashboard'), 'Dashboard title shown in the app bar');

// 2. Every main sidebar entry.
const entries = [
  ['nav-item-events', 'main-event-log', 'widget-event-table'],
  ['nav-item-health', 'main-health', 'widget-state-of-health'],
  ['nav-item-map', 'main-map', 'widget-map'],
  ['nav-item-national', 'main-national', 'widget-national-stats'],
  ['nav-item-report', 'main-report', 'widget-report-generator'],
  ['nav-item-alarm-transfer', 'main-alarm-transfer', 'widget-alarm-transfer'],
  ['nav-item-dashboard', 'main-dashboard', 'widget-adjudication-table'],
];
for (const [nid, id, widget] of entries) {
  await nav(nid);
  const ok = await waitForPage(id) && await page.waitForSelector(`[data-testid="${widget}"]`, { timeout: 30000 }).then(() => true, () => false);
  check(ok, `${nid} opens editable page ${id}`);
}

// 3. A typed ORNL address is redirected.
await page.goto(BASE + '/health/', { waitUntil: 'domcontentloaded' });
check(await waitForPage('main-health'), 'typing /health/ opens the editable State of Health page');

// 4. Clicking a lane on the dashboard opens the editable Lane View for it.
await nav('nav-item-dashboard');
await waitForPage('main-dashboard');
await page.waitForSelector(`[data-testid="lane-health-card-${PORTAL_LANE}"]`, { timeout: 60000 });
await page.locator(`[data-testid="lane-health-card-${PORTAL_LANE}"]`).click();
check(await waitForPage('main-lane-view'), `clicking ${PORTAL_LANE} opens the editable Lane View`);
await page.waitForSelector('[data-testid="widget-video"] video', { timeout: 60000 }).catch(() => {});
check(await page.locator('[data-testid="widget-video"] video').count() > 0, `Lane View shows ${PORTAL_LANE}'s video`);

// 5. RS-350 lanes get the spectra layout, and back.
if (RS350_LANE) {
  await page.locator('[data-testid="page-header-slot"] .MuiSelect-select').first().click();
  await page.getByRole('option', { name: RS350_LANE }).click();
  check(await waitForPage('main-rs350-lane-view'), `choosing ${RS350_LANE} switches to the RS-350 Lane View`);
  await page.waitForSelector('[data-testid="rs350-spectrum-widget"] canvas', { timeout: 60000 }).catch(() => {});
  check(await page.locator('[data-testid="rs350-spectrum-widget"] canvas').count() > 0, `${RS350_LANE} spectra drawn`);
  await page.locator('[data-testid="page-header-slot"] .MuiSelect-select').first().click();
  await page.getByRole('option', { name: PORTAL_LANE }).click();
  check(await waitForPage('main-lane-view'), `choosing ${PORTAL_LANE} switches back to the portal Lane View`);
}

// 6. Edits persist, Reset restores, no Delete.
await nav('nav-item-map');
await waitForPage('main-map');
const before = await page.locator('[data-testid^="widget-"]').count();
await page.click('[data-testid="edit-mode-toggle"]');
await page.click('[data-testid="add-widget-button"]');
await page.click('[data-testid="add-widget-alarm-stats"]');
await sleep(500);
await page.click('[data-testid="edit-mode-toggle"]');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="widget-map"]', { timeout: 30000 });
check(await page.locator('[data-testid="widget-alarm-stats"]').count() === 1, 'a widget added to the main Map page survives a reload');
await page.click('[data-testid="page-menu-button"]');
check(await page.getByRole('menuitem', { name: /delete/i }).count() === 0, 'main pages offer no Delete');
await page.getByRole('menuitem', { name: /reset/i }).click();
await sleep(500);
check(await page.locator('[data-testid^="widget-"]').count() === before && await page.locator('[data-testid="widget-alarm-stats"]').count() === 0,
  'Reset to default restores the main Map layout');

// 7. Switch off: ORNL's original pages; switch on again.
await drawer();
await page.click('[data-testid="editable-main-pages-toggle"]');
await page.waitForURL(u => !u.pathname.startsWith('/custom-page'), { timeout: 30000 }).catch(() => {});
check(path() === '/map', `switching off on the Map page goes to ORNL's /map (${path()})`);
await nav('nav-item-health');
await page.waitForURL(u => u.pathname.replace(/\/+$/, '') === '/health', { timeout: 30000 }).catch(() => {});
const ornlHeading = await page.getByRole('heading', { name: 'Status of Health', exact: true }).first().isVisible({ timeout: 15000 }).catch(() => false);
check(path() === '/health' && ornlHeading, "with the switch off, State of Health is ORNL's original page");
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(2000);
check(path() === '/health', 'the switch setting survives a reload');
await drawer();
await page.click('[data-testid="editable-main-pages-toggle"]');
check(await waitForPage('main-health'), 'switching back on returns to the editable State of Health page');

const appErrors = errors.filter(e => !/SSL certificate|Service ?Worker|MUI X: useResizeContainer|getUserMedia|NotFoundError|Requested device not found/i.test(e))
  .filter(e => !(RS350_LANE && e.includes(`No video control stream is available for lane ${RS350_LANE}`)))
  // Missing retained media (clips, OCR crops) is missing data, not an app error; see check-view-widgets.mjs.
  .filter(e => !(notFound.length > 0 && notFound.every(u => u.includes('/buckets/videos/media/') || u.includes('/buckets/ocr/crops/'))
                 && /Failed to load resource: the server responded with a status of 404/.test(e)));
if (notFound.length) console.log('404s:', JSON.stringify([...new Set(notFound)].slice(0, 8)));
check(appErrors.length === 0, 'no page errors: ' + JSON.stringify(appErrors.slice(0, 5)));
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASS');
await browser.close();
