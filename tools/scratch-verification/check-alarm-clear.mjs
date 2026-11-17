import { open, sleep, ts, BASE } from './harness.mjs';
import fs from 'node:fs';
const OBS = process.env.OBS, CS = process.env.CS;
const PW = fs.readFileSync(process.env.PW_FILE, 'utf8').trim();
const { browser, page, context } = await open();
await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector(`.mobile-alarm-marker[data-occ-obs="${OBS}"]`, { timeout: 60000 });
await page.$eval(`.mobile-alarm-marker[data-occ-obs="${OBS}"]`, el => el.dispatchEvent(new MouseEvent('click', { bubbles: true })));
await sleep(800);
console.log('POPUP', (await page.$eval('.leaflet-popup-content', e => e.innerText).catch(() => 'none')).replace(/\s+/g, ' ').slice(0, 200));
const href = await page.$eval('.leaflet-popup-content a, .leaflet-popup-content button', e => e.getAttribute('href') || e.textContent).catch(() => null);
console.log('VIEW_EVENT target', href);
// adjudicate through the node API (what the event-details form posts)
const body = JSON.stringify({ parameters: { feedback: 'scratch verification', adjudicationCode: 9, isotopesCount: 0, isotopes: [], secondaryInspectionStatus: 'NONE', filePathCount: 0, filePaths: [], occupancyObsId: OBS, vehicleId: '' } });
const res = await context.request.post(`${BASE}/sensorhub/api/controlstreams/${CS}/commands`, { data: body, headers: { 'Content-Type': 'application/json', Authorization: 'Basic ' + Buffer.from('admin:' + PW).toString('base64') } });
console.log(ts(), 'adjudicate', res.status());
const t0 = Date.now(); let gone = null;
for (let i = 0; i < 20 && !gone; i++) { await sleep(5000); if (!(await page.$(`.mobile-alarm-marker[data-occ-obs="${OBS}"]`))) gone = Date.now(); }
console.log('MARKER_CLEARED_AFTER_S', gone ? Math.round((gone - t0) / 1000) : 'never');
await browser.close();
