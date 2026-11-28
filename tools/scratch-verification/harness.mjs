import { chromium } from 'playwright';
import fs from 'node:fs';
export const BASE = process.env.OSCAR_BASE ?? 'https://oscar-scratch.local';
const PW = fs.readFileSync(process.env.PW_FILE, 'utf8').trim();
export async function open() {
  // PW_RESOLVE="MAP <site hostname> <rehearsal ip>" sends the site hostname (which the gateway's
  // certificate and server_name expect) to a rehearsal stack instead of live.
  const browser = await chromium.launch({ headless: true, args: process.env.PW_RESOLVE ? [`--host-resolver-rules=${process.env.PW_RESOLVE}`] : [] });
  const context = await browser.newContext({ ignoreHTTPSErrors: true, httpCredentials: { username: 'admin', password: PW }, viewport: { width: 1600, height: 1000 }, locale: 'en-US' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text().slice(0, 300)); });
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  const u = page.getByLabel('Username');
  if (await u.isVisible({ timeout: 5000 }).catch(() => false)) {
    await u.fill('admin'); await page.getByLabel('Password').fill(PW);
    await Promise.all([page.waitForURL(url => !url.pathname.startsWith('/login'), { timeout: 20000 }), page.getByRole('button', { name: 'Sign in', exact: true }).click()]);
  }
  return { browser, context, page, errors };
}
export const sleep = ms => new Promise(r => setTimeout(r, ms));
export const ts = () => new Date().toISOString().slice(11, 19);
export async function laneStates(page) {
  return page.$$eval('[data-testid^="lane-health-"][data-state]', els => Object.fromEntries(els.map(e => [e.dataset.testid.replace('lane-health-', ''), e.dataset.state])));
}

