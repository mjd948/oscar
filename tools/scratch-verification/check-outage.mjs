import { open, sleep, ts, laneStates, BASE } from './harness.mjs';
import { execSync } from 'node:child_process';
const MOCK = process.env.MOCK, LANE = process.env.LANE, DOWN_S = Number(process.env.DOWN_S ?? 60);
const { browser, page } = await open();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector(`[data-testid="lane-health-card-${LANE}"]`, { timeout: 60000 });
let base = null;
for (let i = 0; i < 18; i++) { await sleep(5000); base = await laneStates(page); if (base[`${LANE}-rpm`] === 'online') break; }
console.log(ts(), 'baseline', JSON.stringify(base));
execSync(`${process.env.MOCKCTL} stop ${MOCK}`); const t0 = Date.now(); console.log(ts(), 'stopped', MOCK);
let offAt = null;
while (Date.now() - t0 < DOWN_S * 1000) { await sleep(5000); const s = await laneStates(page); if (!offAt && s[`${LANE}-rpm`] === 'offline') offAt = Date.now(); }
console.log('OFFLINE_AFTER_S', offAt ? Math.round((offAt - t0) / 1000) : 'never');
execSync(`${process.env.MOCKCTL} start ${MOCK}`); const t1 = Date.now(); console.log(ts(), 'started', MOCK);
let onAt = null;
for (let i = 0; i < 36 && !onAt; i++) { await sleep(5000); const s = await laneStates(page); if (s[`${LANE}-rpm`] === 'online') onAt = Date.now(); }
console.log('ONLINE_AFTER_S', onAt ? Math.round((onAt - t1) / 1000) : 'never', JSON.stringify(await laneStates(page)));
await browser.close();
