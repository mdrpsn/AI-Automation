# Lead Intake & Qualification

An n8n workflow that catches new leads the moment they come in, scores them
with AI, and gets the hot ones in front of sales fast — without a human
having to read every submission first.

## The problem

A contact form or "request a quote" page generates leads in a mix of
temperatures: someone ready to buy this week, someone just browsing, and the
occasional vendor pitch or spam bot. When they all land in one inbox and get
read in order, hot leads sit behind cold noise, and every business owner has
a story about a real customer who slipped through because the email got
buried.

## What it does

1. A webhook catches the form submission the instant it's sent (works with a
   website contact form, Typeform, or any tool that can POST a webhook).
2. The lead is checked against the leads sheet — if the same email already
   submitted in the last 24 hours, it's dropped here. No duplicate alerts,
   no double auto-replies for someone who accidentally submitted twice.
3. An AI classifier (Google Gemini) reads the lead's message and sorts it
   into one of three tiers:

   | Tier | Signal | Action |
   |---|---|---|
   | **Hot** | Urgency, a timeline, or explicit buying intent ("need this this week," "ready to hire") | Instant email alert to sales + an auto-reply promising a callback within the hour |
   | **Warm** | Genuine interest, no urgency yet (general pricing questions, "just exploring") | Auto-reply with a "we'll follow up in a day or two" message — no sales alert, so the team isn't paged for every browser |
   | **Cold / Spam** | Vague, unrelated, or clearly a vendor pitch | Logged only — no email sent to anyone |

4. Every lead — regardless of tier — is appended to a "Leads Tracker" Google
   Sheet with its tier and the reason it was classified that way, so nothing
   is silently dropped and the tracker doubles as a qualification audit
   trail.

## How it works (node by node)

1. **New Lead Webhook** — receives the POST from your form, responds
   immediately so the visitor's browser isn't kept waiting on email sends.
2. **Normalize Lead** — a Code node that pulls `name`/`email`/`phone`/
   `message`/`source` out of whatever field names the form sends and gives
   every lead a `leadId` and timestamp.
3. **Get Existing Leads** — reads the full Leads Tracker sheet.
4. **Check Duplicate** — a Code node comparing the new lead's email against
   the sheet, flagging it as a duplicate only if the same email appears
   *and* was submitted within the last 24 hours.
5. **Not A Duplicate** — filters out anything flagged in step 4.
6. **Qualify Lead** — a Text Classifier node (backed by Gemini) that reads
   the lead's message and sorts it into `hot_lead` / `warm_lead` /
   `cold_lead`.
7. **Tag Hot / Tag Warm / Tag Cold Or Spam** — one Set node per branch,
   recording the tier and a plain-English reason for the log, while keeping
   every other field on the item (`includeOtherFields: true` — see Testing
   status below for why that matters).
8. **Alert Sales - Hot Lead** → **Send Auto-Reply - Hot** — only on the hot
   branch: pages sales, then replies to the lead.
9. **Send Auto-Reply - Warm** — only on the warm branch.
10. **Log Lead** — appends the lead, its tier, and the reason to the Leads
    Tracker sheet. All three branches connect directly into this node's
    single input instead of going through a Merge node (again, see Testing
    status).

## Setting it up for your own business

1. Create a Google Sheet ("Leads Tracker") with columns: `LeadID`, `Name`,
   `Email`, `Phone`, `Message`, `Source`, `Tier`, `QualificationNote`,
   `SubmittedAt`.
2. Import `workflow.json` into your n8n instance.
3. Connect your own credentials (left empty in the export):
   - Google Sheets — on *Get Existing Leads* and *Log Lead*
   - Gmail OAuth2 — on the three send nodes
   - Google Gemini (PaLM) API — on *Google Gemini Chat Model* (free tier at
     [aistudio.google.com](https://aistudio.google.com))
4. Point both Google Sheets nodes at your sheet (`documentId`).
5. Set `Alert Sales - Hot Lead`'s `sendTo` to your sales team's address.
6. Activate the workflow and copy the webhook's production URL into your
   form/tool's "submit to" or "webhook" setting.
7. Adjust the classifier's category descriptions in *Qualify Lead* if "hot"
   means something different for your business (e.g. a specific service
   type or deal size).

## Testing status

Tested end to end against a real, self-hosted n8n instance (free/open-source,
run locally — no n8n cloud account needed) — not just JSON-validated. Google
Sheets, Gmail, and the Gemini classifier were swapped for equivalent mock
nodes for this test run (no real Google credentials were available in this
session), so the *routing and data logic* was exercised for real through
n8n's own execution engine, while the actual AI call and real email/sheet
delivery are still unverified — see below.

Four scenarios were run through the live webhook: a hot lead ("urgent...
ready to hire ASAP"), a warm lead ("interested... just exploring"), a
cold/spam lead (a vendor pitch), and an immediate duplicate resubmission of
the hot lead. All four produced the exact behavior the workflow is designed
for: the hot lead triggered a sales alert plus its own auto-reply, the warm
lead got only an auto-reply, the cold lead got no email at all, every
non-duplicate lead was logged with the correct tier, and the duplicate
produced zero side effects (no alert, no auto-reply, no log entry).

This same testing surfaced and fixed three real bugs that JSON validation
alone would never have caught:

1. **A brand-new/empty Leads Tracker sheet silently killed the entire
   workflow.** `Get Existing Leads` returning 0 rows (exactly what happens
   before the very first lead is ever logged) made n8n halt the whole
   execution right there — the first lead a business ever received would
   vanish with no alert, no reply, no log entry, and no error. Fixed by
   setting `alwaysOutputData: true` on that node.
2. **The `Tag Hot` / `Tag Warm` / `Tag Cold Or Spam` Set nodes were
   silently dropping every field except the two they set.** n8n's Set node
   defaults `includeOtherFields` to `false`, so `name`, `email`, `phone`,
   and `leadId` were all gone by the time the auto-reply and logging steps
   needed them — auto-replies would have gone to a blank address. Fixed by
   setting `includeOtherFields: true` on all three.
3. **The `Merge Branches` node silently dropped every lead.** Since only
   one of the three tier branches ever fires per execution, a Merge node
   downstream never receives a "no data" signal from the two branches that
   didn't run, and n8n's engine finishes the execution without ever
   invoking it with the item that *did* arrive — `Log Lead` never ran, for
   any tier. Fixed by removing the Merge node and wiring all three branch
   endpoints directly into `Log Lead`'s single input instead (multiple
   sources feeding one input is valid n8n wiring, and only one of them
   fires per execution anyway).

**Still unverified**, since it needs real credentials this session didn't
have: the actual Gemini API call's classification quality (the routing
logic was exercised using a keyword-based stand-in, not a live model), and
real Gmail/Sheets delivery (n8n's OAuth setup for those needs an interactive
browser consent flow tied to your own Google account). Before going live,
connect real credentials and re-run the same four scenarios once against
the real Gmail/Sheets/Gemini nodes.

## Known limitations

- The classifier reads only the message text — it doesn't weigh things like
  company size or deal value unless the form collects them and they're fed
  into the `inputText` expression.
- Dedup is by exact email match within a 24-hour window; a lead who
  resubmits under a different email (or misspells it) won't be caught.
- Auto-reply and alert copy are static template strings in the workflow,
  same tradeoff as the invoice automation — fine for one business voice,
  would move to a template store for multi-tenant use.

## Built with

n8n · Google Gemini (free tier) · Google Sheets
