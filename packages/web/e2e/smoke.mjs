/**
 * End-to-end smoke test for the organizer console.
 *
 * Drives a whole session in a real browser: check in, band into courts, start
 * and end a game, undo, take a break, and end the session. Run the dev server
 * first, then `npm run e2e` from the repo root.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3111';
const OUT = process.argv[2] ?? null;
const errors = [];

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

const step = async (label, fn) => {
  try { await fn(); console.log(`  ok  ${label}`); }
  catch (e) { console.log(`FAIL  ${label}: ${e.message}`); errors.push(`${label}: ${e.message}`); }
};

await page.goto(BASE, { waitUntil: 'networkidle' });

await step('create session', async () => {
  await page.getByPlaceholder('Session name (optional)').fill('Tuesday night');
  await page.getByRole('button', { name: 'Create session' }).click();
  await page.waitForURL(/\/session\//);
});

// Check in a spread of players across skill bands.
const roster = [
  ['Ana', 3.5], ['Ben', 3.5], ['Cy', 3.25], ['Dee', 3.25],
  ['Eli', 4.0], ['Fay', 4.0], ['Gus', 4.25], ['Hana', 4.0],
  ['Ivy', 2.75], ['Jon', 3.0], ['Kai', 3.0], ['Lena', 2.75],
];

await step('check in 12 players', async () => {
  await page.getByRole('button', { name: 'roster' }).click();
  for (const [name, rating] of roster) {
    await page.getByPlaceholder('Player name').fill(name);
    await page.getByRole('button', { name: rating.toFixed(2), exact: true }).first().click();
    await page.getByRole('button', { name: 'Check in' }).click();
  }
  await page.waitForFunction(() => document.body.innerText.includes('Roster (12)'));
});

await step('start the session', async () => {
  await page.getByRole('button', { name: 'Start', exact: true }).click();
  await page.getByRole('button', { name: 'courts' }).click();
  await page.waitForSelector('text=up next');
});

if (OUT) await page.screenshot({ path: `${OUT}/01-proposals.png`, fullPage: true });

let firstFour = [];
await step('proposals are skill-banded', async () => {
  const cards = await page.locator('div.card').filter({ hasText: 'up next' }).all();
  if (cards.length < 3) throw new Error(`expected 3 proposals, got ${cards.length}`);
  for (const card of cards) {
    const text = await card.innerText();
    const avgs = [...text.matchAll(/avg (\d+\.\d+)/g)].map((m) => Number(m[1]));
    if (avgs.length !== 2) throw new Error(`expected 2 team averages, got ${avgs.length}`);
    const gap = Math.abs(avgs[0] - avgs[1]);
    if (gap > 0.35) throw new Error(`team averages ${avgs} differ by ${gap.toFixed(2)}`);
  }
  firstFour = (await cards[0].innerText()).match(/^[A-Z][a-z]+$/gm) ?? [];
});

await step('explanation names a reason', async () => {
  const card = page.locator('div.card').filter({ hasText: 'up next' }).first();
  const text = await card.innerText();
  if (!/spread/.test(text) || !/teams/.test(text)) {
    throw new Error(`explanation missing detail: ${text.slice(-200)}`);
  }
});

await step('start a match', async () => {
  await page.locator('div.card').filter({ hasText: 'up next' })
    .first().getByRole('button', { name: 'Start' }).click();
  await page.waitForSelector('text=End game');
});

if (OUT) await page.screenshot({ path: `${OUT}/02-match-running.png`, fullPage: true });

await step('queue drops the four now playing', async () => {
  await page.getByRole('button', { name: /^queue/ }).click();
  const items = await page.locator('main ul > li').count();
  if (items !== 8) throw new Error(`expected 8 in queue, got ${items}`);
});

await step('end match with a score', async () => {
  await page.getByRole('button', { name: 'courts' }).click();
  await page.getByRole('button', { name: 'End game' }).click();
  await page.getByLabel('Team A score').fill('11');
  await page.getByLabel('Team B score').fill('7');
  await page.getByRole('button', { name: 'A won' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('1 games'));
});

await step('those four are back in the queue', async () => {
  await page.getByRole('button', { name: /^queue/ }).click();
  const items = await page.locator('main ul > li').count();
  if (items !== 12) throw new Error(`expected 12 in queue, got ${items}`);
});

await step('players who just played drop down the queue', async () => {
  const names = await page.locator('main ul > li').allInnerTexts();
  const topFour = names.slice(0, 4).map((t) => t.split('\n')[0].trim());
  const overlap = topFour.filter((n) => firstFour.includes(n));
  if (overlap.length > 0) throw new Error(`just-played players still at top: ${overlap}`);
});

await step('undo restores the previous state', async () => {
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.waitForFunction(() => document.body.innerText.includes('0 games'));
  await page.getByRole('button', { name: 'courts' }).click();
  await page.waitForSelector('text=End game');
});

await step('take a break and rejoin', async () => {
  await page.getByRole('button', { name: /^queue/ }).click();
  const before = await page.locator('main ul > li').count();
  await page.locator('main ul > li').first().getByRole('button', { name: 'break' }).click();
  const paused = page.locator('main ul > li').filter({ hasText: 'on break' });
  await paused.first().waitFor({ timeout: 5000 });
  if (await paused.count() !== 1) throw new Error('expected exactly one paused player');
  await paused.first().getByRole('button', { name: 'back' }).click();
  await page.waitForFunction(
    (n) => document.querySelectorAll('main ul > li').length === n, before);
  if (await page.locator('main ul > li').filter({ hasText: 'on break' }).count() !== 0) {
    throw new Error('player did not come back from break');
  }
});

if (OUT) await page.screenshot({ path: `${OUT}/03-queue.png`, fullPage: true });

await step('ending mid-game records it rather than discarding it', async () => {
  await page.getByRole('button', { name: 'courts' }).click();
  const dialogs = [];
  page.once('dialog', (d) => { dialogs.push(d.message()); d.accept(); });
  await page.getByRole('button', { name: 'End', exact: true }).click();
  await page.waitForSelector('text=Rating review');
  if (!/still on court/.test(dialogs[0] ?? '')) {
    throw new Error(`expected a warning about the running game, got: ${dialogs[0]}`);
  }
  const body = await page.locator('body').innerText();
  // The game that was on court must survive into the summary.
  if (/0 games/.test(body)) throw new Error('in-flight game was discarded on session end');
  if (!/1 games/.test(body)) throw new Error(`expected 1 game recorded, body: ${body.slice(0,200)}`);
});

if (OUT) await page.screenshot({ path: `${OUT}/04-summary.png`, fullPage: true });

await step('reload keeps the session', async () => {
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForSelector('text=Rating review');
});

await browser.close();

console.log(`\n${errors.length === 0 ? 'ALL PASSED' : `${errors.length} PROBLEM(S)`}`);
for (const e of errors) console.log(` - ${e}`);
process.exit(errors.length === 0 ? 0 : 1);
