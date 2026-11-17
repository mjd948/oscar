import { open, sleep, ts, BASE } from './harness.mjs';
import { execSync } from 'node:child_process';
const LANE = process.env.LANE ?? 'Marshall', PID = process.env.CPID, PORT = process.env.RTSP_PORT ?? '9001';
const { browser, page, errors } = await open();
await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
await page.waitForSelector(`[data-testid="lane-health-card-${LANE}"]`, { timeout: 60000 });
await page.click(`[data-testid="lane-health-card-${LANE}"]`);
await page.waitForURL(u => u.pathname.startsWith('/lane-view'), { timeout: 20000 });
const t0 = Date.now();
const vstate = () => page.$$eval('video', vs => vs.map(v => ({ t: +v.currentTime.toFixed(1), w: v.videoWidth, h: v.videoHeight, rs: v.readyState, paused: v.paused })));
let first = null;
for (let i = 0; i < 30 && !first; i++) { await sleep(1000); const v = await vstate(); if (v.some(x => x.t > 0)) first = Date.now(); }
console.log('VIDEO_START_S', first ? ((first - t0) / 1000).toFixed(1) : 'never', JSON.stringify(await vstate()));
await sleep(5000); console.log(ts(), 'playing', JSON.stringify(await vstate()));
// cut this camera's RTSP inside the scratch container's netns only
execSync(`nsenter -t ${PID} -n iptables -I OUTPUT -p tcp -d 10.235.20.94 --dport ${PORT} -j REJECT --reject-with tcp-reset`);
console.log(ts(), 'RTSP cut');
for (let i = 0; i < 9; i++) { await sleep(5000); console.log(ts(), 'cut', JSON.stringify(await vstate()), await page.$eval('[data-testid="live-video-auto-retry"],[data-testid="live-video-error"],[data-testid="live-video-preparing"]', e => e.dataset.testid + ':' + e.innerText.replace(/\\s+/g,' ')).catch(() => '')); }
execSync(`nsenter -t ${PID} -n iptables -D OUTPUT -p tcp -d 10.235.20.94 --dport ${PORT} -j REJECT --reject-with tcp-reset`);
const t1 = Date.now(); console.log(ts(), 'RTSP restored');
let prev = (await vstate())[0], resumed = null;
for (let i = 0; i < 36 && !resumed; i++) { await sleep(5000); const v = (await vstate())[0]; console.log(ts(), 'after', JSON.stringify(v)); if (v && prev && !v.paused && v.t !== prev.t && v.t > 0) resumed = Date.now(); prev = v; }
console.log('VIDEO_RESUMED_AFTER_S', resumed ? Math.round((resumed - t1) / 1000) : 'never');
console.log('PAGE_ERRORS', errors.filter(e => !/SSL certificate|Service ?Worker/i.test(e)).slice(0, 6));
await browser.close();
