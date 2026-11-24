// The Video Stream widget fits ORNL's live player inside its frame: the picture is visible
// without scrolling (ORNL's player is a fixed 500 px <video> sized for the Lane View page).
import { open, sleep, waitForDashboard } from './harness.mjs';
const { browser, page, errors } = await open();
const fail = [];
const check = (ok, msg) => { console.log(ok ? 'PASS' : 'FAIL', msg); if (!ok) fail.push(msg); };

await page.getByLabel('open drawer').or(page.locator('button[aria-label="Open drawer"]')).first().click().catch(() => {});
await page.click('[data-testid="add-page-button"]');
await page.getByLabel('Page name').fill('Video fit check');
await page.getByLabel('Template').click();
await page.getByRole('option', { name: 'Lane View layout', exact: true }).click();
await page.getByRole('button', { name: /create/i }).click();
// The site is already on a dashboard (it opens on the built-in Dashboard): wait for the new one's name.
if (!await waitForDashboard(page, 'Video fit check')) throw new Error('new dashboard Video fit check did not open');
await page.waitForSelector('[data-testid="widget-video"]', { timeout: 30000 });
await page.locator('[data-testid="page-header-slot"] .MuiSelect-select').first().click();
await page.getByRole('option', { name: process.env.LANE ?? 'Marshall' }).click();
await page.waitForSelector('[data-testid="widget-video"] video', { timeout: 60000 });
await sleep(12000);

const fit = await page.$$eval('[data-testid="widget-video"]', ws => ws.map(w => {
  const v = w.querySelector('video');
  const wr = w.getBoundingClientRect(), vr = v.getBoundingClientRect();
  const scrollers = [...w.querySelectorAll('*')].filter(e => e.scrollHeight > e.clientHeight + 1 && getComputedStyle(e).overflowY !== 'visible' && getComputedStyle(e).overflowY !== 'hidden');
  return { widgetH: Math.round(wr.height), videoH: Math.round(vr.height), videoBottom: Math.round(vr.bottom), widgetBottom: Math.round(wr.bottom),
           scrollers: scrollers.length, playing: v.currentTime > 0 && v.videoWidth > 0 };
}));
console.log(JSON.stringify(fit));
check(fit.length > 0, 'video widget present');
for (const f of fit) {
  check(f.videoBottom <= f.widgetBottom && f.videoH < 500, `player fits its frame (video ${f.videoH}px in widget ${f.widgetH}px)`);
  check(f.scrollers === 0, 'no scrollbar inside the widget');
  check(f.playing, 'video plays');
}
await page.screenshot({ path: process.env.SHOT ?? '/tmp/video-fit.png' });
const appErrors = errors.filter(e => !/SSL certificate|Service ?Worker|MUI X: useResizeContainer/i.test(e));
check(appErrors.length === 0, 'no page errors: ' + JSON.stringify(appErrors.slice(0, 5)));
console.log(fail.length ? `FAILED ${fail.length}` : 'ALL PASS');
await browser.close();
