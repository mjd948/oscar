// Custom widget dashboards on ORNL 3.11: the site opens on the built-in Dashboard, pages created
// from templates persist across reload, widgets render, edit-mode add widget, two maps on one page.
import { open, sleep, ts, BASE, waitForDashboard } from './harness.mjs';
const { browser, page, errors } = await open();
const fail = [];
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail.push(msg); };

await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
check(await waitForDashboard(page, 'dashboard'), 'the site opens on the built-in Dashboard');
await page.waitForSelector('[data-testid^="lane-health-card-"]', { timeout: 30000 }).catch(() => {});
check(await page.locator('[data-testid^="lane-health-card-"]').count() >= 4, 'the Dashboard renders its lane cards');

async function createPage(name, templateLabel) {
  await page.getByLabel('open drawer').or(page.locator('button[aria-label="Open drawer"]')).first().click().catch(() => {});
  await page.click('[data-testid="add-page-button"]');
  await page.getByLabel('Page name').fill(name);
  await page.getByLabel('Template').click();
  await page.getByRole('option', { name: templateLabel, exact: true }).click();
  await page.getByRole('button', { name: /create/i }).click();
  // The site is already on a dashboard (it opens on the built-in Dashboard): wait for the new one's name.
  if (!await waitForDashboard(page, name)) throw new Error(`new dashboard ${name} did not open`);
  return page.url();
}

const dashUrl = await createPage('Ops wall', 'Dashboard layout');
await page.waitForSelector('[data-testid="widget-system-status"]', { timeout: 30000 });
await sleep(8000);
check(await page.locator('[data-testid="widget-system-status"] [data-testid^="lane-health-card-"]').count() >= 4, 'dashboard template: lane status widget shows lane cards');
check(await page.locator('[data-testid="widget-adjudication-table"] .MuiDataGrid-root').count() === 1, 'dashboard template: alarm table widget renders ORNL grid');
check(await page.locator('[data-testid="widget-quick-view"] .leaflet-container').count() === 1, 'dashboard template: quick view shows the map');

await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForSelector('[data-testid="widget-system-status"]', { timeout: 30000 });
check(page.url() === dashUrl, 'page survives reload at the same URL' + (page.url() === dashUrl ? '' : ` (${dashUrl} -> ${page.url()})`));
check(await page.locator('[data-testid="custom-pages-nav"]').textContent().then(t => (t ?? '').includes('Ops wall')).catch(() => false), 'page listed in the nav drawer');

// edit mode: add a map widget and alarm stats next to the quick-view map
await page.click('[data-testid="edit-mode-toggle"]');
for (const type of ['map', 'alarm-stats']) {
  await page.click('[data-testid="add-widget-button"]');
  await page.click(`[data-testid="add-widget-${type}"]`);
  await sleep(500);
}
await page.click('[data-testid="edit-mode-toggle"]');
await sleep(20000);
check(await page.locator('.leaflet-container').count() === 2, 'two maps (quick view + map widget) render side by side');
const statsText = await page.locator('[data-testid="widget-alarm-stats"]').innerText().catch(() => '');
check(statsText.length > 0 && !/failed to load|unknown widget/i.test(statsText), 'alarm stats widget renders: ' + statsText.replace(/\s+/g, ' ').slice(0, 120));

const laneUrl = await createPage('Lane wall', 'Lane View layout');
await page.waitForSelector('[data-testid="widget-video"]', { timeout: 30000 });
// pick a lane in the page toolbar (app bar)
const laneSelect = page.locator('[data-testid="page-header-slot"] .MuiSelect-select').first();
await laneSelect.click();
await page.getByRole('option', { name: 'Marshall' }).click();
await sleep(15000);
const v = await page.$$eval('[data-testid="widget-video"] video', vs => vs.map(x => ({ t: x.currentTime, w: x.videoWidth })));
check(v.length > 0 && v.some(x => x.t > 0 && x.w > 0), 'lane template: video widget plays Marshall camera ' + JSON.stringify(v));
check(await page.locator('[data-testid="widget-chart"] canvas').count() > 0, 'lane template: chart widget draws');
check(await page.locator('[data-testid="widget-status-table"] .MuiDataGrid-root').count() >= 1, 'lane template: lane log table renders');

await page.screenshot({ path: process.env.SHOT ?? '/tmp/custom-pages.png', fullPage: false });
const appErrors = errors.filter(e => !/SSL certificate|Service ?Worker|MUI X: useResizeContainer/i.test(e));
check(appErrors.length === 0, 'no page errors: ' + JSON.stringify(appErrors.slice(0, 5)));
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASS');
await browser.close();
