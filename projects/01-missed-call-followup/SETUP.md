# Setup Checklist

Ordered so each step unblocks the next. Realistic time estimates included — Google OAuth is the slow part, not n8n itself.

## 1. n8n instance (~10 min)

- [ ] Sign up for n8n Cloud free tier (fastest path) at n8n.io, or self-host if you'd rather run it locally/on a VPS.
- [ ] Free tier note: n8n Cloud's free trial is time-limited and execution-limited — fine for building and demoing, not for running a real client's workflow long-term. Budget for a paid tier (or self-hosted) before this goes live for an actual customer.
- [ ] Create a new empty workflow, then **Import from File** → select `workflow.json` from this folder.

## 2. Anthropic API key (~5 min)

- [ ] Create a key at console.anthropic.com (requires billing set up — pay-as-you-go, no free tier for API usage).
- [ ] In n8n, create a credential of type **HTTP Header Auth**: header name `x-api-key`, value = your key.
- [ ] Open the "Draft Follow-Up Message (Claude)" node → attach that credential.
- [ ] Cost check: this workflow's Claude call is short (~200 output tokens) — a few hundred test runs will cost cents, not dollars. Don't over-worry about this during testing.

## 3. Twilio (~15 min)

- [ ] Sign up for a Twilio trial account.
- [ ] Buy/activate an SMS-capable phone number (trial accounts get free trial credit that covers this).
- [ ] **Trial account gotcha**: trial numbers can only send SMS to phone numbers you've manually verified in the Twilio console. You'll need to verify your own test phone number before the "Send SMS to Lead" node will actually deliver anything. This is the #1 thing that makes people think the workflow is broken when it isn't.
- [ ] In n8n, create a **Twilio API** credential with your Account SID + Auth Token.
- [ ] In `workflow.json`'s "Send SMS to Lead" node, replace `REPLACE_WITH_TWILIO_NUMBER` with your Twilio number, and attach the credential.

## 4. Google (Calendar + Sheets) (~20–30 min — the slow one)

- [ ] Create a Google Cloud project (console.cloud.google.com) if you don't already have one for this.
- [ ] Enable the **Google Calendar API** and **Google Sheets API** for that project.
- [ ] Set up an OAuth consent screen (External, testing mode is fine for now) and create OAuth 2.0 credentials (Web application type).
- [ ] Add n8n's OAuth redirect URL (n8n shows this when you create the credential) to the authorized redirect URIs in Google Cloud.
- [ ] In n8n, create a **Google Calendar OAuth2** credential and a **Google Sheets OAuth2** credential using the Client ID/Secret from Google Cloud, then complete the OAuth consent flow.
- [ ] Attach the Calendar credential to "Create Tentative Booking Hold".
- [ ] Create an actual Google Sheet with a tab named `Leads` and header row: `Name | Phone | Service | CallTime | FollowUpSent`. Copy its Sheet ID (from the URL) into the "Log Lead to CRM Sheet" node, replacing `REPLACE_WITH_SHEET_ID`. Attach the Sheets credential.

## 5. Email notification (~5–10 min)

- [ ] Simplest option: a Gmail account with an **App Password** (requires 2FA enabled on the account) used as SMTP credentials in n8n.
- [ ] Create an **SMTP** credential in n8n with those details.
- [ ] In the "Notify Business Owner" node, replace `REPLACE_WITH_DOMAIN.com` and `REPLACE_WITH_OWNER_EMAIL`, and attach the credential.

## 6. Test end-to-end (~5 min)

- [ ] Open the "Missed Call / Lead Webhook" node, click **Listen for Test Event** (or copy the Test URL).
- [ ] From a terminal: `curl -X POST <test-webhook-url> -H "Content-Type: application/json" -d @sample-payloads/missed-call.json`
- [ ] Confirm, in order: the workflow executes without a red (error) node, your verified test phone gets the SMS, the Google Calendar hold appears, a new row lands in the Sheet, and the notification email arrives.
- [ ] If the SMS doesn't arrive but everything else works: check the Twilio trial verified-numbers restriction above first — it's the most common cause.

## 7. Go live

- [ ] Toggle the workflow **Active** in n8n — this gives you a production webhook URL (different from the test URL).
- [ ] Point whatever real trigger you're using (call-tracking service webhook, Twilio voice webhook, or a lead form's webhook action) at the production URL.
- [ ] Re-run the same curl test against the production URL once to confirm it behaves identically.

## Known limitations worth being upfront about (with yourself or a client)

- This uses a fake/simulated "missed call" trigger (a webhook you POST to). Wiring an *actual* phone call to trigger this requires either a call-tracking service with webhooks (e.g., CallRail) or Twilio Voice's own missed-call webhook — that's a follow-up integration step per client, not something this workflow does on its own yet.
- No dedup/rate-limiting: if the same lead calls twice in a minute, they'll get two follow-up texts. Fine for a demo, worth fixing (a lookup against the Sheet before sending) before charging a client.
