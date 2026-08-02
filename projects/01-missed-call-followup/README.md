# 01 — Missed-Call Follow-Up Automation

## The problem

Home-service businesses (HVAC, plumbing, electrical, cleaning, salons, contractors) miss a large share of inbound calls and web inquiries during business hours — on a job, on another call, after hours. A missed lead usually just calls the next business on the list; there's no voicemail follow-through in most small shops.

## What this automation does

1. A missed call, web form, or SMS inquiry triggers a webhook (from a call-tracking service, Twilio voice webhook, or a lead-capture form — whatever the client already has).
2. Claude drafts a short, personalized SMS reply acknowledging the lead and offering to book a time, using whatever info came in (name, service requested).
3. The SMS is sent to the lead via Twilio.
4. A tentative hold is placed on the business's Google Calendar so the owner sees the opportunity immediately.
5. The lead is logged to a Google Sheet as a lightweight CRM.
6. The business owner gets an email notifying them a lead was auto-followed-up, so they can personally take over if they want.

## Why this sells

- One-sentence ROI pitch: *"You're losing leads to competitors because nobody replies fast enough — this replies in under a minute, every time, even after hours."*
- Demoable in under two minutes with a fake webhook call — no need to actually miss a phone call live on a client demo.
- Realistic pricing for a business this size: $500–1500 one-time setup, optional $50–150/month for monitoring and Claude/Twilio usage pass-through.

## Stack

- **n8n** — workflow engine (self-hosted or n8n Cloud free tier for demos)
- **Anthropic Claude API** — drafts the follow-up SMS (called directly via HTTP Request node, no SDK)
- **Twilio** — sends the SMS
- **Google Calendar** — creates the tentative booking hold
- **Google Sheets** — lead log / lightweight CRM
- **Email (SMTP)** — notifies the business owner

## Setup

1. Import `workflow.json` into n8n (Workflows → Import from File).
2. Add credentials in n8n:
   - **Anthropic**: HTTP Header Auth credential, header name `x-api-key`, value = your Claude API key. Attach it to the "Draft Follow-Up Message (Claude)" node.
   - **Twilio**: Account SID + Auth Token, and a Twilio phone number capable of sending SMS.
   - **Google**: OAuth2 credential with Calendar and Sheets scopes.
   - **Email**: SMTP credential (or swap the Email node for Gmail/Slack if the client prefers).
3. Replace the placeholders in the workflow:
   - Twilio `from` number
   - Google Calendar ID (defaults to `primary`)
   - Google Sheet ID and tab name in the "Log Lead to CRM Sheet" node
   - Owner notification email address
4. Activate the workflow to get a production webhook URL, or use the test webhook URL during setup.
5. Test end-to-end without a real phone call: POST the contents of `sample-payloads/missed-call.json` to the webhook URL.

## Demo script (for a client call or a recorded walkthrough)

1. Show the webhook firing with the sample payload (a fake missed call).
2. Show the SMS arriving on a test phone within seconds.
3. Show the calendar hold and the new row in the Google Sheet.
4. Show the owner notification email.
5. Close with the one-sentence ROI pitch above.

## What's being learned building this

See the root [LEARNING.md](../../LEARNING.md).
