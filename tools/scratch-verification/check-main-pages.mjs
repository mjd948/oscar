// Built-in dashboards: the sidebar has two sections (every widget dashboard, then settings) with
// no ORNL page switch; every built-in opens at its name URL (/dashboard/?name=...), as do a typed
// ORNL address and a lane click; Lane View picks the RS-350 layout for RS-350 lanes; edits survive
// a reload and Reset restores the layout; a built-in can be renamed (its URL follows) and
// deleted (it stays deleted, its ORNL route shows ORNL's page until a dashboard made from the
// same layout takes it back); home falls back to the first dashboard; legacy /custom-page URLs
// redirect.
//   OSCAR_BASE=https://<host> PW_FILE=<admin pw file> [RS350_LANE="Patrol 1"|""] [PORTAL_LANE=Marshall] node check-main-pages.mjs
import { open, sleep, BASE, dashboardName, waitForDashboard } from './harness.mjs';
const { browser, page, errors } = await open();
const fail = [];
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail.push(msg); };
const RS350_LANE = process.env.RS350_LANE ?? 'Patrol 1';
const PORTAL_LANE = process.env.PORTAL_LANE ?? 'Marshall';
const notFound = [];
page.on('response', r => { if (r.status() === 404) notFound.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
const path = () => new URL(page.url()).pathname.replace(/\/+$/, '') || '/';
const waitForName = (slug) => page.waitForURL(u => u.pathname.replace(/\/+$/, '') === '/dashboard' && u.searchParams.get('name') === slug, { timeout: 30000 }).then(() => true, () => false);
async function drawer() {
  // The toggle hides itself while the drawer is open.
  const toggle = page.locator('[data-testid="navbar-drawer-toggle"]');
  if (await toggle.isVisible().catch(() => false)) { await toggle.click(); await sleep(400); }
}
async function nav(testId) {
  await drawer();
  await page.locator(`[data-testid="${testId}"]`).first().click();
}
async function pageMenu(itemTestIdOrName) {
  await page.click('[data-testid="page-menu-button"]');
  const item = typeof itemTestIdOrName === 'string'
    ? page.locator(`[data-testid="${itemTestIdOrName}"]`)
    : page.getByRole('menuitem', { name: itemTestIdOrName });
  await item.click();
}
async function deleteCurrent() {
  await pageMenu('delete-page-button');
  await page.click('[data-testid="confirm-delete-page"]');
}

// 1. Landing on / opens the built-in Dashboard at its name URL.
check(await waitForName('dashboard'), `opening the site lands on /dashboard/?name=dashboard (${page.url()})`);
await page.waitForSelector('[data-testid="widget-system-status"]', { timeout: 30000 });
check(await page.locator('[data-testid="edit-mode-toggle"]').count() === 1, 'Dashboard has Edit Layout');
check((await page.locator('[data-testid="page-header-slot"]').innerText()).includes('Dashboard'), 'Dashboard title shown in the app bar');

// 2. The sidebar: dashboards (with + last), then settings; no ORNL page links and no switch.
if (process.env.SHOT_DIR) await page.locator('.MuiDrawer-paper').first().screenshot({ path: `${process.env.SHOT_DIR}/sidebar-collapsed.png` });
await drawer();
check((await page.locator('[data-testid="nav-item-health"]').innerText()).includes('Status of Health'), 'the open sidebar shows the dashboard names');
if (process.env.SHOT_DIR) await page.locator('.MuiDrawer-paper').first().screenshot({ path: `${process.env.SHOT_DIR}/sidebar-default.png` });
const navList = page.locator('[data-testid="custom-pages-nav"]');
const navIds = await navList.locator('[data-testid^="nav-"], [data-testid="add-page-button"]').evaluateAll(els => els.map(e => e.getAttribute('data-testid')));
check(JSON.stringify(navIds) === JSON.stringify(['nav-item-dashboard', 'nav-item-events', 'nav-item-health', 'nav-item-map',
  'nav-item-national', 'nav-item-report', 'nav-item-alarm-transfer', 'add-page-button']),
  `dashboards section lists the built-ins then + (${navIds.join(', ')})`);
const drawerPaper = page.locator('.MuiDrawer-paper').first();
check(await drawerPaper.locator('ul.MuiList-root').count() === 2, 'the sidebar has two sections');
check(await page.locator('[data-testid="editable-main-pages-toggle"]').count() === 0, 'no switch back to ORNL pages');
const drawerHrefs = await drawerPaper.locator('a[href]').evaluateAll(as => as.map(a => new URL(a.href).pathname.replace(/\/+$/, '')));
check(drawerHrefs.every(h => h === '/dashboard' || ['/users', '/usb-backups', '/extensions', '/servers'].includes(h)),
  `sidebar links are dashboards or settings only (${[...new Set(drawerHrefs)].join(', ')})`);

// 3. Every built-in entry.
const entries = [
  ['nav-item-events', 'events', 'widget-event-table'],
  ['nav-item-health', 'state-of-health', 'widget-state-of-health'],
  ['nav-item-map', 'map', 'widget-map'],
  ['nav-item-national', 'national', 'widget-national-stats'],
  ['nav-item-report', 'report-generator', 'widget-report-generator'],
  ['nav-item-alarm-transfer', 'alarm-transfer', 'widget-alarm-transfer'],
  ['nav-item-dashboard', 'dashboard', 'widget-adjudication-table'],
];
for (const [nid, slug, widget] of entries) {
  await nav(nid);
  const ok = await waitForName(slug) && await page.waitForSelector(`[data-testid="${widget}"]`, { timeout: 30000 }).then(() => true, () => false);
  check(ok, `${nid} opens /dashboard/?name=${slug}`);
}

// 4. A typed ORNL address and a legacy URL are redirected.
await page.goto(BASE + '/health/', { waitUntil: 'domcontentloaded' });
check(await waitForName('state-of-health'), 'typing /health/ opens the State of Health dashboard');
await page.goto(BASE + '/custom-page/?id=main-map', { waitUntil: 'domcontentloaded' });
check(await waitForName('map'), 'legacy /custom-page/?id=main-map is rewritten to /dashboard/?name=map');

// 5. Clicking a lane on the dashboard opens the Lane View dashboard for it.
await nav('nav-item-dashboard');
await waitForName('dashboard');
await page.waitForSelector(`[data-testid="lane-health-card-${PORTAL_LANE}"]`, { timeout: 60000 });
await page.locator(`[data-testid="lane-health-card-${PORTAL_LANE}"]`).click();
check(await waitForName('lane-view'), `clicking ${PORTAL_LANE} opens the Lane View dashboard`);
await page.waitForSelector('[data-testid="widget-video"] video', { timeout: 60000 }).catch(() => {});
check(await page.locator('[data-testid="widget-video"] video').count() > 0, `Lane View shows ${PORTAL_LANE}'s video`);

// 6. RS-350 lanes get the spectra layout, and back.
if (RS350_LANE) {
  await page.locator('[data-testid="page-header-slot"] .MuiSelect-select').first().click();
  await page.getByRole('option', { name: RS350_LANE }).click();
  check(await waitForName('rs350-lane-view'), `choosing ${RS350_LANE} switches to the RS-350 Lane View`);
  await page.waitForSelector('[data-testid="rs350-spectrum-widget"] canvas', { timeout: 60000 }).catch(() => {});
  check(await page.locator('[data-testid="rs350-spectrum-widget"] canvas').count() > 0, `${RS350_LANE} spectra drawn`);
  await page.locator('[data-testid="page-header-slot"] .MuiSelect-select').first().click();
  await page.getByRole('option', { name: PORTAL_LANE }).click();
  check(await waitForName('lane-view'), `choosing ${PORTAL_LANE} switches back to the portal Lane View`);
}

// 7. Edits persist, Reset restores.
await nav('nav-item-map');
await waitForName('map');
const before = await page.locator('[data-testid^="widget-"]').count();
await page.click('[data-testid="edit-mode-toggle"]');
await page.click('[data-testid="add-widget-button"]');
await page.click('[data-testid="add-widget-alarm-stats"]');
await sleep(500);
await page.click('[data-testid="edit-mode-toggle"]');
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="widget-map"]', { timeout: 30000 });
check(await page.locator('[data-testid="widget-alarm-stats"]').count() === 1, 'a widget added to the Map dashboard survives a reload');
await pageMenu(/reset/i);
await sleep(500);
check(await page.locator('[data-testid^="widget-"]').count() === before && await page.locator('[data-testid="widget-alarm-stats"]').count() === 0,
  'Reset to default restores the Map layout');

// 8. Rename a built-in: the URL and the sidebar follow, and a reload keeps it.
await pageMenu(/page settings/i);
await page.locator('[data-testid="page-name-input"]').fill('Yard map');
await page.getByRole('button', { name: 'Save', exact: true }).click();
check(await waitForName('yard-map'), `renaming Map to "Yard map" moves it to /dashboard/?name=yard-map (${page.url()})`);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="widget-map"]', { timeout: 30000 });
check(dashboardName(page) === 'yard-map' && (await page.locator('[data-testid="page-header-slot"]').innerText()).includes('Yard map'),
  'the renamed dashboard reloads under its new name');
await drawer();
check((await page.locator('[data-testid="nav-item-map"]').innerText()).includes('Yard map'), 'the sidebar shows the new name');
if (process.env.SHOT_DIR) await page.locator('.MuiDrawer-paper').first().screenshot({ path: `${process.env.SHOT_DIR}/sidebar-open.png` });

// 9. Delete the built-in Events: gone from the sidebar for good, ORNL's page takes /event-log.
await nav('nav-item-events');
await waitForName('events');
await deleteCurrent();
await sleep(1500);
await drawer();
check(await page.locator('[data-testid="nav-item-events"]').count() === 0, 'deleted Events is gone from the sidebar');
await page.reload({ waitUntil: 'domcontentloaded' });
await sleep(3000);
await drawer();
check(await page.locator('[data-testid="nav-item-events"]').count() === 0, 'deleted Events stays deleted after a reload');
await page.goto(BASE + '/event-log/', { waitUntil: 'domcontentloaded' });
await sleep(5000);
await page.waitForSelector('.MuiDataGrid-root', { timeout: 30000 }).catch(() => {});
check(path() === '/event-log' && await page.locator('[data-testid="main-page-redirecting"]').count() === 0
  && await page.locator('.MuiDataGrid-root').count() > 0, `with Events deleted, /event-log is ORNL's Events page (${path()})`);

// 10. A dashboard made from "Events layout" takes /event-log back.
await drawer();
await page.click('[data-testid="add-page-button"]');
await page.getByLabel('Page name').fill('Alarms');
await page.getByLabel('Template').click();
await page.getByRole('option', { name: 'Events layout', exact: true }).click();
await page.getByRole('button', { name: /create/i }).click();
check(await waitForDashboard(page, 'Alarms'), 'a dashboard made from Events layout opens at /dashboard/?name=alarms');
await page.goto(BASE + '/event-log/', { waitUntil: 'domcontentloaded' });
check(await waitForName('alarms'), 'and /event-log now opens it');

// 11. Delete the built-in Dashboard: home lands on the first remaining dashboard.
await nav('nav-item-dashboard');
await waitForName('dashboard');
await deleteCurrent();
check(await waitForName('state-of-health'), `with Dashboard deleted, / opens the first dashboard left (${page.url()})`);
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
check(await waitForName('state-of-health'), 'and typing / does too');

const appErrors = errors.filter(e => !/SSL certificate|Service ?Worker|MUI X: useResizeContainer|getUserMedia|NotFoundError|Requested device not found/i.test(e))
  .filter(e => !(RS350_LANE && e.includes(`No video control stream is available for lane ${RS350_LANE}`)))
  // Missing retained media (clips, OCR crops) is missing data, not an app error; see check-view-widgets.mjs.
  .filter(e => !(notFound.length > 0 && notFound.every(u => u.includes('/buckets/videos/media/') || u.includes('/buckets/ocr/crops/'))
                 && /Failed to load resource: the server responded with a status of 404/.test(e)));
if (notFound.length) console.log('404s:', JSON.stringify([...new Set(notFound)].slice(0, 8)));
check(appErrors.length === 0, 'no page errors: ' + JSON.stringify(appErrors.slice(0, 5)));
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASS');
await browser.close();
