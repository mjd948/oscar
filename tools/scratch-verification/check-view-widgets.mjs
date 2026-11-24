// Widgets for ORNL's remaining views: State of Health, Report Generator, Alarm Transfer, Event
// Lookup, Event Details (follows the clicked table row) and RS-350 spectra.
//   OSCAR_BASE=https://<host> PW_FILE=<admin pw file> [RS350_LANE="Patrol 1"] [PORTAL_LANE=Marshall] node check-view-widgets.mjs
import { open, sleep, waitForDashboard } from './harness.mjs';
const { browser, page, errors } = await open();
const fail = [];
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail.push(msg); };
// RS350_LANE="" skips the spectra section (e.g. when the site's RS-350 is offline).
const RS350_LANE = process.env.RS350_LANE ?? 'Patrol 1';
const PORTAL_LANE = process.env.PORTAL_LANE ?? 'Marshall';

async function createPage(name, templateLabel) {
  await page.getByLabel('open drawer').or(page.locator('button[aria-label="Open drawer"]')).first().click().catch(() => {});
  await page.click('[data-testid="add-page-button"]');
  await page.getByLabel('Page name').fill(name);
  await page.getByLabel('Template').click();
  await page.getByRole('option', { name: templateLabel, exact: true }).click();
  await page.getByRole('button', { name: /create/i }).click();
  // The site is already on a dashboard (it opens on the built-in Dashboard): wait for the new one's name.
  if (!await waitForDashboard(page, name)) throw new Error(`new dashboard ${name} did not open`);
}
async function addWidget(type) {
  await page.click('[data-testid="edit-mode-toggle"]');
  await page.click('[data-testid="add-widget-button"]');
  await page.click(`[data-testid="add-widget-${type}"]`);
  await sleep(500);
  await page.click('[data-testid="edit-mode-toggle"]');
}
async function pickLane(name) {
  await page.locator('[data-testid="page-header-slot"] .MuiSelect-select').first().click();
  await page.getByRole('option', { name }).click();
}
const notFound = [];
page.on('response', r => { if (r.status() === 404) notFound.push(r.url().replace(/^https?:\/\/[^/]+/, '')); });
const text = async (sel) => (await page.locator(sel).first().innerText().catch(() => '')).replace(/\s+/g, ' ');

// State of Health
await createPage('Health wall', 'Status of Health layout');
await page.waitForSelector('[data-testid="widget-state-of-health"] [data-testid^="health-lane-"]', { timeout: 60000 });
const healthRows = await page.locator('[data-testid="widget-state-of-health"] [data-testid^="health-lane-"]').count();
check(healthRows >= 4, `state of health lists lanes (${healthRows} rows)`);
check(!(await page.locator('[data-testid="widget-state-of-health"] h1').isVisible()), "state of health: ORNL's page heading hidden in the widget");

// Report Generator
await createPage('Reports', 'Report Generator layout');
await page.waitForSelector('[data-testid="report-generator-widget"]', { timeout: 30000 });
await sleep(3000);
const reportText = await text('[data-testid="report-generator-widget"]');
check(reportText.length > 80 && (await page.locator('[data-testid="report-generator-widget"] .MuiSelect-select, [data-testid="report-generator-widget"] select').count()) > 0,
  'report generator renders its form: ' + reportText.slice(0, 80));

// Alarm Transfer
await createPage('Transfers', 'Alarm Transfer layout');
await page.waitForSelector('[data-testid="alarm-transfer-widget"]', { timeout: 30000 });
check(await page.locator('[data-testid="alarm-transfer-widget"] [data-testid="alarm-transfer-file-input"]').count() === 1, 'alarm transfer renders the import panel');

// Events: lookup + table, then event details following the clicked row
await createPage('Events wall', 'Events layout');
await page.waitForSelector('[data-testid="event-lookup-widget"] input', { timeout: 30000 });
check(true, 'events template carries the event lookup');
await addWidget('event-details');
check((await text('[data-testid="widget-event-details"]')).includes('Select an event'), 'event details waits for a selection');
await page.waitForSelector('[data-testid="widget-event-table"] .MuiDataGrid-row', { timeout: 120000 });
await page.locator('[data-testid="widget-event-table"] .MuiDataGrid-row').first().click();
await page.waitForSelector('[data-testid="event-details-widget"] canvas', { timeout: 60000 }).catch(() => {});
const canvases = await page.locator('[data-testid="event-details-widget"] canvas').count();
check(canvases > 0, `event details draws the event's charts (${canvases} canvas)`);
await page.waitForSelector('[data-testid="event-details-widget-open-page"]', { timeout: 30000 }).catch(() => {});
check(await page.locator('[data-testid="event-details-widget-open-page"]').count() === 1, 'event details resolved the event id (Open full page offered)');
check(page.url().includes('/dashboard/'), 'selecting an event did not navigate away from the page');
if (process.env.SHOT_DIR) await page.locator('[data-testid="widget-event-details"]').screenshot({ path: `${process.env.SHOT_DIR}/widget-event-details.png` });

if (RS350_LANE) {
  // RS-350 spectra
  await createPage('Spectra', 'Lane View layout');
  await page.waitForSelector('[data-testid="widget-video"]', { timeout: 30000 });
  await addWidget('rs350-spectrum');
  await pickLane(RS350_LANE);
  await page.waitForSelector('[data-testid="rs350-spectrum-widget"]', { timeout: 60000 }).catch(() => {});
  await sleep(15000);
  const spectrumCanvas = await page.locator('[data-testid="rs350-spectrum-widget"] canvas').count();
  check(spectrumCanvas > 0, `RS-350 spectra drawn for ${RS350_LANE} (${spectrumCanvas} canvas)`);
  if (process.env.SHOT_DIR) await page.locator('[data-testid="widget-rs350-spectrum"]').screenshot({ path: `${process.env.SHOT_DIR}/widget-rs350-spectrum.png` });
  await page.screenshot({ path: process.env.SHOT ?? '/tmp/view-widgets.png' });
  await pickLane(PORTAL_LANE);
  await page.waitForSelector('[data-testid="rs350-spectrum-not-rs350"]', { timeout: 30000 }).catch(() => {});
  check(await page.locator('[data-testid="rs350-spectrum-not-rs350"]').count() === 1, `RS-350 widget explains ${PORTAL_LANE} is not an RS-350 lane`);
}

// Retained media can be missing: a fresh event's clip is not finalised yet, and retention or
// storage-pressure cleanup removes clips and OCR crops. ORNL's own /event-details page requests the
// same files and gets the same 404s, so they are reported as missing data, not app errors.
const isRetainedMedia = (u) => u.includes('/buckets/videos/media/') || u.includes('/buckets/ocr/crops/');
const onlyClip404s = notFound.length > 0 && notFound.every(isRetainedMedia);
if (onlyClip404s) console.log(`NOTE ${notFound.length} retained-media file(s) not on the node (missing data, not an app error)`);
const appErrors = errors.filter(e => !/SSL certificate|Service ?Worker|MUI X: useResizeContainer|getUserMedia|NotFoundError|Requested device not found/i.test(e))
  .filter(e => !(onlyClip404s && /Failed to load resource: the server responded with a status of 404/.test(e)))
  // ORNL's RS350BackpackView embeds its video player even for a camera-less RS-350 lane, which
  // logs this on ORNL's own Lane View too.
  .filter(e => !(RS350_LANE && e.includes(`No video control stream is available for lane ${RS350_LANE}`)));
if (notFound.length) console.log('404s:', JSON.stringify([...new Set(notFound)].slice(0, 8)));
check(appErrors.length === 0, 'no page errors: ' + JSON.stringify(appErrors.slice(0, 5)));
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASS');
await browser.close();
