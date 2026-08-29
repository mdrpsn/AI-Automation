/**
 * End-to-end test for the live player view.
 *
 * Runs two browser contexts at once — the organizer's console and a player's
 * phone — and checks that publishing works, updates propagate, and nothing
 * private leaks into the public page.
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

// Separate contexts: the player must not inherit the organizer's storage.
const organizerCtx = await browser.newContext({ viewport: { width: 420, height: 900 } });
const playerCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const organizer = await organizerCtx.newPage();
const player = await playerCtx.newPage();

for (const [name, page] of [['organizer', organizer], ['player', player]]) {
  page.on('pageerror', (e) => errors.push(`${name} pageerror: ${e.message}`));
}

await organizer.goto(BASE, { waitUntil: 'networkidle' });

const roster = [
  ['Ana', 3.5], ['Ben', 3.5], ['Cy', 3.25], ['Dee', 3.25],
  ['Eli', 4.0], ['Fay', 4.0], ['Gus', 3.75], ['Hana', 3.75],
];

await step('set up a session', async () => {
  await organizer.getByPlaceholder('Session name (optional)').fill('Live test');
  await organizer.getByRole('button', { name: 'Create session' }).click();
  await organizer.waitForURL(/\/session\//);
  await organizer.getByRole('button', { name: 'roster' }).click();
  for (const [name, rating] of roster) {
    await organizer.getByPlaceholder('Player name').fill(name);
    await organizer.getByRole('button', { name: rating.toFixed(2), exact: true }).first().click();
    await organizer.getByRole('button', { name: 'Check in' }).click();
  }
  await organizer.getByRole('button', { name: 'Start', exact: true }).click();
});

// Mark one pair as "keep apart" — private data that must never be published.
await step('set a private keep-apart pair', async () => {
  await organizer.getByRole('button', { name: 'roster' }).click();
  await organizer.getByRole('button', { name: 'Ana', exact: true }).click();
  await organizer.getByRole('button', { name: 'Ben', exact: true }).last().click();
});

let liveUrl = '';
await step('start sharing and get a QR', async () => {
  await organizer.getByRole('button', { name: 'share' }).click();
  await organizer.getByRole('button', { name: 'Start sharing' }).click();
  await organizer.waitForSelector('svg', { timeout: 10000 });
  liveUrl = await organizer.getByLabel('Share link').inputValue();
  if (!/\/live\/[a-z0-9]{22}$/.test(liveUrl)) throw new Error(`bad share url: ${liveUrl}`);
  await organizer.waitForSelector('text=Players can see this', { timeout: 10000 });
});

if (OUT) await organizer.screenshot({ path: `${OUT}/05-share.png`, fullPage: true });

await step('player opens the link and sees the queue', async () => {
  await player.goto(liveUrl, { waitUntil: 'domcontentloaded' });
  await player.waitForSelector('text=Live test');
  const body = await player.locator('body').innerText();
  for (const [name] of roster) {
    if (!body.includes(name)) throw new Error(`player page missing ${name}`);
  }
});

await step('ratings are hidden from players by default', async () => {
  const body = await player.locator('body').innerText();
  for (const r of ['3.50', '3.25', '4.00', '3.75']) {
    if (body.includes(r)) throw new Error(`rating ${r} leaked to the player page`);
  }
});

await step('private keep-apart data never reaches the player page', async () => {
  const html = await player.content();
  for (const marker of ['avoid', 'accumulatedDelta', 'stretchCredit', 'publishToken', 'ratingLocked']) {
    if (html.includes(marker)) throw new Error(`"${marker}" leaked into the player page`);
  }
});

await step('the player page offers no way to change anything', async () => {
  // Scoped to the page's own content: Next injects a dev-overlay button.
  const buttons = await player.locator('main button').count();
  const inputs = await player.locator('main input, main textarea, main select').count();
  if (buttons + inputs !== 0) {
    throw new Error(`player page exposed ${buttons} buttons and ${inputs} inputs`);
  }
});

await step('starting a match reaches the player page', async () => {
  await organizer.getByRole('button', { name: 'courts' }).click();
  const proposal = organizer.locator('div.card').filter({ hasText: 'up next' }).first();

  // Capture who is about to go on, so the player page can be checked against
  // the actual four rather than a guess.
  const names = await proposal.locator('span.truncate.font-semibold').allInnerTexts();
  if (names.length !== 4) throw new Error(`expected 4 names in the proposal, got ${names}`);

  await proposal.getByRole('button', { name: 'Start' }).click();
  await organizer.waitForSelector('text=End game');

  // The player page is long-polling; it should pick this up without a reload.
  await player.waitForSelector('text=On court', { timeout: 20000 });
  await player.waitForFunction(
    (expected) => {
      const courts = document.querySelector('main')?.innerText ?? '';
      return expected.every((n) => courts.includes(n));
    },
    names,
    { timeout: 20000 },
  );
});

if (OUT) await player.screenshot({ path: `${OUT}/06-player-view.png`, fullPage: true });

await step('players are told when they are up next', async () => {
  await player.waitForFunction(() => document.body.innerText.includes('up next'), undefined,
    { timeout: 20000 });
});

await step('turning ratings on publishes them', async () => {
  await organizer.getByRole('button', { name: 'share' }).click();
  await organizer.getByRole('checkbox').check();
  await player.waitForFunction(() => /\b\d\.\d\d?\b/.test(document.body.innerText), undefined,
    { timeout: 20000 });
});

await step('rotating the link revokes the old one', async () => {
  organizer.once('dialog', (d) => d.accept());
  await organizer.getByRole('button', { name: 'New link' }).click();
  await organizer.waitForFunction(
    (old) => {
      const input = document.querySelector('input[aria-label="Share link"]');
      return input instanceof HTMLInputElement && input.value !== old;
    },
    liveUrl,
    { timeout: 10000 },
  );

  const stale = await playerCtx.newPage();
  await stale.goto(liveUrl, { waitUntil: 'domcontentloaded' });
  const body = await stale.locator('body').innerText();
  if (!body.includes('Session not found')) {
    throw new Error('the revoked link still works');
  }
  await stale.close();
});

await step('stop sharing takes the page down', async () => {
  const current = await organizer.getByLabel('Share link').inputValue();
  await organizer.getByRole('button', { name: 'Stop sharing' }).click();
  await organizer.waitForSelector('text=Start sharing');

  const after = await playerCtx.newPage();
  await after.goto(current, { waitUntil: 'domcontentloaded' });
  if (!(await after.locator('body').innerText()).includes('Session not found')) {
    throw new Error('page still live after stopping sharing');
  }
  await after.close();
});

await browser.close();

console.log(`\n${errors.length === 0 ? 'ALL PASSED' : `${errors.length} PROBLEM(S)`}`);
for (const e of errors) console.log(` - ${e}`);
process.exit(errors.length === 0 ? 0 : 1);
