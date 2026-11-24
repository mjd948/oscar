import { chromium } from 'playwright';
import fs from 'node:fs';
export const BASE = process.env.OSCAR_BASE ?? 'https://oscar-scratch.local';
const PW = fs.readFileSync(process.env.PW_FILE, 'utf8').trim();
export async function open() {
  const browser = await chromium.launch({ headless: true });
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

// Widget dashboards live at /dashboard/?name=<slug>, the slug made from the dashboard's name
// (MainPages.ts slugify); a clashing name gets -2, -3, ...
export const slugOf = name => name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'dashboard';
export const dashboardName = page => {
  const u = new URL(page.url());
  return u.pathname.replace(/\/+$/, '') === '/dashboard' ? u.searchParams.get('name') : null;
};
/** Wait for the dashboard called `name` (or its -2, -3 ... twin) to be the open page. */
export const waitForDashboard = (page, name, timeout = 30000) => {
  const slug = slugOf(name);
  return page.waitForURL(u => u.pathname.replace(/\/+$/, '') === '/dashboard'
    && new RegExp(`^${slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(-\\d+)?$`, 'u').test(u.searchParams.get('name') ?? ''), { timeout })
    .then(() => true, () => false);
};
