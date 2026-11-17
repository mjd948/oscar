import { open, sleep, ts, BASE } from './harness.mjs';
const { browser, page, errors } = await open();
await page.goto(BASE + '/map', { waitUntil: 'domcontentloaded' });
await page.waitForSelector('.mobile-unit-marker', { timeout: 60000 }).catch(() => {});
const snap = async () => page.$$eval('.mobile-unit-marker', els => els.map(e => ({ title: e.querySelector('[data-walker-state]')?.getAttribute('title'), state: e.querySelector('[data-walker-state]')?.dataset.walkerState, tf: e.style.transform })));
const s0 = await snap(); console.log(ts(), 'walkers', JSON.stringify(s0));
await sleep(30000);
const s1 = await snap(); console.log(ts(), 'walkers', JSON.stringify(s1));
console.log('MOVED', s0.map((w, i) => w.tf !== s1[i]?.tf));
const alarms = await page.$$eval('.mobile-alarm-marker', els => els.map(e => e.getAttribute('data-occ-obs')));
console.log('ALARM_MARKERS', alarms);
const center0 = await page.evaluate(() => document.querySelector('.leaflet-map-pane')?.style.transform);
await sleep(10000);
console.log('MAP_PANE_STABLE', center0 === await page.evaluate(() => document.querySelector('.leaflet-map-pane')?.style.transform));
if (alarms.length) {
  await page.click(`.mobile-alarm-marker[data-occ-obs="${alarms[0]}"]`, { force: true });
  await sleep(1000);
  console.log('POPUP', (await page.$eval('.leaflet-popup-content', e => e.innerText).catch(() => 'none')).replace(/\s+/g, ' ').slice(0, 300));
}
console.log('PAGE_ERRORS', errors.filter(e => !/SSL certificate|Service ?Worker/i.test(e)).slice(0, 5));
await page.screenshot({ path: process.env.SHOT });
await browser.close();
