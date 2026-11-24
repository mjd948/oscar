// Event-table widget column preferences persist: hide a column via the grid's own menu, widen
// another by dragging its separator, reload, and both stick. ORNL's /event-log is unaffected.
import { open, sleep, BASE, waitForDashboard } from './harness.mjs';
const { browser, page, errors } = await open();
const results = [];
const check = (ok, msg) => { results.push(ok); console.log(ok ? 'PASS' : 'FAIL', msg); };
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.click('[data-testid="add-page-button"]');
await page.getByLabel('Page name').fill('Events wall');
await page.getByRole('button', { name: /create/i }).click();
// The site is already on a dashboard (it opens on the built-in Dashboard): wait for the new one's name.
if (!await waitForDashboard(page, 'Events wall')) throw new Error('new dashboard Events wall did not open');
await page.click('[data-testid="edit-mode-toggle"]');
await page.click('[data-testid="add-widget-button"]');
await page.click('[data-testid="add-widget-event-table"]');
await page.click('[data-testid="edit-mode-toggle"]');
const grid = page.locator('[data-testid="widget-event-table"]');
const header = (field) => grid.locator(`.MuiDataGrid-columnHeader[data-field="${field}"]`);
await header('maxGamma').waitFor({ timeout: 30000 });

await header('maxGamma').hover();
await header('maxGamma').locator('.MuiDataGrid-menuIcon button').click();
await page.getByRole('menuitem', { name: /hide column/i }).click();
await sleep(500);
check(await header('maxGamma').count() === 0, 'Max Gamma hidden');

const before = (await header('status').boundingBox()).width;
const sep = header('status').locator('.MuiDataGrid-columnSeparator');
const box = await sep.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
await page.mouse.up();
await sleep(500);
const widened = (await header('status').boundingBox()).width;
check(widened > before + 60, `Status widened ${Math.round(before)} -> ${Math.round(widened)}px`);

await page.reload({ waitUntil: 'domcontentloaded' });
await header('status').waitFor({ timeout: 30000 });
check(await header('maxGamma').count() === 0, 'Max Gamma still hidden after reload');
const after = (await header('status').boundingBox()).width;
check(Math.abs(after - widened) < 6, `Status width survives reload (${Math.round(after)}px)`);

await page.goto(BASE + '/event-log', { waitUntil: 'domcontentloaded' });
await page.locator('.MuiDataGrid-columnHeader[data-field="maxGamma"]').waitFor({ timeout: 30000 });
check(true, "ORNL /event-log still shows Max Gamma (widget prefs don't leak)");
check(errors.filter(e => !/SSL|Service ?Worker|useResizeContainer/i.test(e)).length === 0, 'no page errors');
console.log(results.every(Boolean) ? 'ALL PASS' : 'FAILED');
await browser.close();
