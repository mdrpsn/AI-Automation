/**
 * End-to-end test for self check-in.
 *
 * A player scans the QR, fills in the form, and waits for the organizer to
 * accept them. Runs both sides at once so the hand-off is actually exercised.
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:3111';
const OUT = process.argv[2] ?? null;
const errors = [];

const step = async (label, fn) => {
  try { await fn(); console.log(`  ok  ${label}`); }
  catch (e) { console.log(`FAIL  ${label}: ${e.message}`); errors.push(`${label}: ${e.message}`); }
};

const browser = await chromium.launch(
  process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {},
);
const organizerCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const playerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const organizer = await organizerCtx.newPage();
const player = await playerCtx.newPage();

for (const [name, page] of [['organizer', organizer], ['player', player]]) {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
}

let shareToken = '';

await step('organizer opens a session and starts sharing', async () => {
  await organizer.goto(BASE, { waitUntil: 'networkidle' });
  await organizer.getByPlaceholder('Session name (optional)').fill('Check-in test');
  await organizer.getByRole('button', { name: 'Create session' }).click();
  await organizer.waitForURL(/\/session\//);

  // Four players so the session can start; check-in adds a fifth.
  await organizer.getByRole('button', { name: 'roster' }).click();
  for (const name of ['Ana', 'Ben', 'Cy', 'Dee']) {
    await organizer.getByPlaceholder('Player name').fill(name);
    await organizer.getByRole('button', { name: '3.50', exact: true }).first().click();
    await organizer.getByRole('button', { name: 'Check in' }).click();
  }
  await organizer.getByRole('button', { name: 'Start', exact: true }).click();

  await organizer.getByRole('button', { name: 'share' }).click();
  await organizer.getByRole('button', { name: 'Start sharing' }).click();
  await organizer.waitForSelector('text=Players can see this', { timeout: 10000 });
  const url = await organizer.getByLabel('Share link').inputValue();
  shareToken = url.split('/live/')[1];
});

await step('check-in is closed until the organizer opens it', async () => {
  await player.goto(`${BASE}/join/${shareToken}`, { waitUntil: 'domcontentloaded' });
  const body = await player.locator('body').innerText();
  if (!body.includes('Check-in is closed')) {
    throw new Error(`expected a closed notice, got: ${body.slice(0, 160)}`);
  }
});

await step('the live page offers no check-in link while it is closed', async () => {
  await player.goto(`${BASE}/live/${shareToken}`, { waitUntil: 'domcontentloaded' });
  if ((await player.locator('main a[href*="/join/"]').count()) !== 0) {
    throw new Error('check-in link shown while check-in is closed');
  }
});

await step('organizer opens check-in', async () => {
  await organizer.locator('label').filter({ hasText: 'Let players check themselves in' })
    .locator('input[type=checkbox]').check();
  await organizer.waitForSelector('text=Require a DUPR ID', { timeout: 10000 });
});

await step('the live page now points players at check-in', async () => {
  await player.goto(`${BASE}/live/${shareToken}`, { waitUntil: 'domcontentloaded' });
  await player.waitForSelector('main a[href*="/join/"]', { timeout: 20000 });
});

await step('the live page still exposes no way to change anything', async () => {
  // A link navigates; it does not mutate. The invariant is that nothing on the
  // live page can alter the session.
  const buttons = await player.locator('main button').count();
  const inputs = await player.locator('main input, main textarea, main select').count();
  if (buttons + inputs !== 0) {
    throw new Error(`live page exposed ${buttons} buttons and ${inputs} inputs`);
  }
});

await step('a player checks themselves in', async () => {
  await player.locator('main a[href*="/join/"]').click();
  await player.waitForSelector('button[data-ready="true"]', { timeout: 20000 });
  await player.getByPlaceholder('First name and last initial is plenty').fill('Priya');
  await player.getByRole('button', { name: '4.00', exact: true }).click();
  await player.getByRole('button', { name: 'Check in' }).click();
  await player.waitForSelector('text=/on the list/', { timeout: 15000 });
});

if (OUT) await player.screenshot({ path: `${OUT}/07-join-done.png`, fullPage: true });

await step('they are not in the queue until the organizer accepts', async () => {
  await organizer.getByRole('button', { name: /^queue/ }).click();
  const queue = await organizer.locator('main ul > li').allInnerTexts();
  if (queue.some((row) => row.includes('Priya'))) {
    throw new Error('a self check-in reached the queue without being accepted');
  }
});

await step('the organizer sees them waiting, with their claimed level', async () => {
  await organizer.getByRole('button', { name: /^roster/ }).click();
  await organizer.waitForSelector('text=Priya', { timeout: 15000 });
  const tray = await organizer.locator('section').filter({ hasText: /^Checking in/ }).innerText();
  if (!/says 4/.test(tray)) throw new Error(`claimed rating not shown: ${tray.slice(0, 200)}`);
});

if (OUT) await organizer.screenshot({ path: `${OUT}/08-checkin-tray.png`, fullPage: true });

await step('accepting puts them in the queue, flagged as self-rated', async () => {
  await organizer.locator('section').filter({ hasText: /^Checking in/ })
    .getByRole('button', { name: 'Accept' }).first().click();

  await organizer.waitForFunction(
    () => !document.body.innerText.includes('says 4'),
    undefined,
    { timeout: 10000 },
  );

  const roster = await organizer.locator('section').filter({ hasText: /^Roster \(/ }).innerText();
  if (!roster.includes('Priya')) throw new Error('accepted player missing from the roster');
  if (!roster.includes('self-rated')) throw new Error('accepted player not flagged as self-rated');

  await organizer.getByRole('button', { name: /^queue/ }).click();
  const queue = await organizer.locator('main ul > li').allInnerTexts();
  if (!queue.some((row) => row.includes('Priya'))) {
    throw new Error('accepted player did not reach the queue');
  }
});

await step('confirming the rating clears the flag', async () => {
  await organizer.getByRole('button', { name: /^roster/ }).click();
  await organizer.locator('section').filter({ hasText: /^Roster \(/ })
    .getByRole('button', { name: /Priya/ }).click();
  await organizer.getByRole('button', { name: 'Looks right' }).click();
  // Scoped to the roster: the tray's own help text also says "self-rated".
  await organizer.waitForFunction(
    () => {
      const roster = [...document.querySelectorAll('section')]
        .find((s) => /^Roster \(/.test(s.innerText));
      return roster !== undefined && !roster.innerText.includes('self-rated');
    },
    undefined,
    { timeout: 10000 },
  );
});

await step('a second check-in under the same name is flagged as a duplicate', async () => {
  await player.goto(`${BASE}/join/${shareToken}`, { waitUntil: 'domcontentloaded' });
  await player.waitForSelector('button[data-ready="true"]', { timeout: 20000 });
  await player.getByPlaceholder('First name and last initial is plenty').fill('priya');
  await player.getByRole('button', { name: '4.00', exact: true }).click();
  await player.getByRole('button', { name: 'Check in' }).click();
  await player.waitForSelector('text=/on the list/', { timeout: 15000 });

  await organizer.getByRole('button', { name: /^roster/ }).click();
  await organizer.waitForSelector('text=already checked in', { timeout: 15000 });
});

await step('declining removes them without adding anyone', async () => {
  const before = await organizer.locator('section').filter({ hasText: /^Roster \(/ }).innerText();
  await organizer.locator('section').filter({ hasText: /^Checking in/ })
    .getByRole('button', { name: 'Decline' }).first().click();
  await organizer.waitForFunction(
    () => !document.body.innerText.includes('already checked in'),
    undefined,
    { timeout: 10000 },
  );
  const after = await organizer.locator('section').filter({ hasText: /^Roster \(/ }).innerText();
  if (before.replace(/\s+/g, '') !== after.replace(/\s+/g, '')) {
    throw new Error('declining changed the roster');
  }
});

await step('requiring a DUPR ID makes the form insist on one', async () => {
  await organizer.getByRole('button', { name: 'share' }).click();
  await organizer.locator('label').filter({ hasText: 'Require a DUPR ID' })
    .locator('input[type=checkbox]').check();

  // Wait for the change to reach the relay before reloading the player's page.
  await player.waitForTimeout(1200);
  await player.goto(`${BASE}/join/${shareToken}`, { waitUntil: 'domcontentloaded' });
  await player.waitForSelector('button[data-ready="true"]', { timeout: 20000 });
  await player.waitForFunction(
    () => !document.body.innerText.includes('(optional)'),
    undefined,
    { timeout: 20000 },
  );
  await player.getByPlaceholder('First name and last initial is plenty').fill('Sam');
  await player.getByRole('button', { name: '3.50', exact: true }).click();
  await player.getByRole('button', { name: 'Check in' }).click();

  await player.waitForSelector('main [role=alert]', { timeout: 10000 });
  const alert = await player.locator('main [role=alert]').innerText();
  if (!/DUPR/i.test(alert)) throw new Error(`expected a DUPR prompt, got: ${alert}`);
});

await step('a valid DUPR ID gets through and reaches the organizer', async () => {
  await player.getByPlaceholder('e.g. AB12CD').fill('ab-12cd');
  await player.getByRole('button', { name: 'Check in' }).click();
  await player.waitForSelector('text=/on the list/', { timeout: 15000 });

  await organizer.getByRole('button', { name: /^roster/ }).click();
  await organizer.waitForSelector('text=DUPR AB12CD', { timeout: 15000 });
});

await step('closing check-in shuts the door again', async () => {
  await organizer.getByRole('button', { name: 'share' }).click();
  await organizer.locator('label').filter({ hasText: 'Let players check themselves in' })
    .locator('input[type=checkbox]').uncheck();

  await player.waitForTimeout(1200);
  await player.goto(`${BASE}/join/${shareToken}`, { waitUntil: 'domcontentloaded' });
  await player.waitForFunction(
    () => document.body.innerText.includes('Check-in is closed'),
    undefined,
    { timeout: 20000 },
  );
});

await browser.close();

console.log(`\n${errors.length === 0 ? 'ALL PASSED' : `${errors.length} PROBLEM(S)`}`);
for (const e of errors) console.log(` - ${e}`);
process.exit(errors.length === 0 ? 0 : 1);
