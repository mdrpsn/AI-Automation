# Invoice Follow-Up Automation

An n8n workflow that chases unpaid invoices automatically, so a small business
doesn't have to remember to nag people for money.

## The problem

Most small service businesses track invoices in a spreadsheet and rely on someone
remembering to follow up when one goes unpaid. That reminder either doesn't happen,
happens too late, or happens to a customer who already paid — all three erode trust
and cost real revenue.

## What it does

Every morning, the workflow reads an "Invoice Tracker" Google Sheet and, for every
unpaid invoice, decides whether it needs a nudge:

| Stage | When | Action |
|---|---|---|
| 1 | 3 days before due | Friendly reminder email to the customer |
| 2 | Due today | "Due today" email to the customer |
| 3 | 7 days overdue | Firmer overdue email to the customer |
| 4 | 14+ days overdue | **No automated email to the customer.** Instead, alerts the business owner to make a personal call. |

Two things make this safe to leave running unattended:

- **It never double-sends.** Each invoice row stores the last reminder stage it
  received. The workflow only acts when the invoice has moved into a *new* stage
  it hasn't already been notified for — so running it daily doesn't mean daily
  spam.
- **It stops chasing money automatically once things get serious.** Stages 1–3 are
  low-stakes reminders, safe to automate. Stage 4 (two weeks overdue with no
  response) hands off to a human instead of escalating on its own — an automated
  "pay up" email at that point does more harm than good to the customer
  relationship.
- **Paid invoices are skipped entirely** — the moment a row's `Status` changes to
  `Paid`, the workflow ignores it on every future run.

## How it works (node by node)

1. **Daily Check** — Schedule Trigger, runs once a day.
2. **Get All Invoices** — reads every row from the Invoice Tracker sheet.
3. **Unpaid Only** — filters out anything already marked `Paid`.
4. **Compute Reminder Stage** — a Code node that calculates how many days
   overdue (or until due) each invoice is, decides which stage it's in, and
   whether that stage is *new* (i.e., hasn't already been sent).
5. **Should Send** — filters out invoices that don't need any action this run.
6. **Is Final Notice** — branches stage-4 invoices away from the automated
   customer email path.
7. **Alert Owner - Needs Call** / **Send Reminder Email** — Gmail nodes that
   send the actual message.
8. **Update Reminder Stage** — writes the new stage and today's date back to the
   sheet, so tomorrow's run knows this invoice was already handled.

## Setting it up for your own business

1. Duplicate a Google Sheet with these columns: `InvoiceID`, `CustomerName`,
   `CustomerEmail`, `Amount`, `DueDate` (`YYYY-MM-DD`), `Status` (`Unpaid`/`Paid`),
   `ReminderStage` (start at `0`), `LastReminderSent`.
2. Connect your own Google Sheets and Gmail credentials to the relevant nodes.
3. Point the two Google Sheets nodes at your sheet (`documentId`).
4. Set `Alert Owner - Needs Call`'s `sendTo` to the address that should get the
   "make a call" alert.
5. Adjust the day thresholds in the Code node if 3/0/7/14 days doesn't match how
   your business actually operates.

## Tested, not just built

Ran end to end against 5 real sample invoices (a mix of overdue, due today,
upcoming, and already-paid) in a real Google Sheet:

- All 4 unpaid invoices were correctly classified into their stage and received
  a real, delivered Gmail message.
- The already-paid invoice was correctly skipped.
- Running it again immediately afterward sent **nothing** — confirming the
  no-double-send logic actually holds, not just in theory.

One real bug surfaced during testing: the Gmail credential's OAuth token had
gone stale, which the first test run caught immediately (a hard failure, not a
silent skip). Swapped to a freshly-authorized credential and re-ran clean.

## Known limitations

- Reminder copy is currently in the Code node as plain template strings — fine
  for one voice/tone, would move to a separate template store for multiple
  businesses or multi-language support.
- No SMS channel — email only. Adding SMS would mean adding a provider (e.g.
  Twilio) alongside the existing Gmail step, not restructuring the workflow.
