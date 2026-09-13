# Operations reference — Long Branch, September 12, 2026

Canonical: https://gigislongbranch.com
Repository: `~/Projects/gigis-long-branch-demo`. Deployment runs through the existing Vercel project;
`.env.local` is the local configuration file. Never paste secrets into this document.

## Configuration

| Variables | Purpose |
| --- | --- |
| `ORDER_PROVIDER`, `VITE_ORDER_PROVIDER` | `inhouse` for API and browser ordering |
| `VITE_DELIVERY_ENABLED`, `VITE_CLOVER_APPLE_PAY` | Delivery enabled (`true`); Apple Pay (`1`) |
| `CLOVER_API_TOKEN`, `CLOVER_MERCHANT_ID`, `VITE_CLOVER_PAKMS_KEY` | Merchant credentials and public tokenization key |
| `DATABASE_URL` | This location's Neon database |
| `TURNSTILE_SECRET_KEY`, `VITE_TURNSTILE_SITE_KEY` | Server bot verification and browser widget |
| `RESEND_API_KEY`, `EMAIL_FROM` | Transactional email and verified sender |
| `DIGEST_EMAIL`, `DIGEST_FROM` | Owner digest recipient and explicitly verified sender |
| `STAFF_ALERT_PHONE`, `STAFF_ALERT_EMAIL` | Lost-order SMS and email fallback |
| `VIP_SIGNUP_ALERT_PHONE` | Long Branch signup notices; Sea Bright currently uses `STAFF_ALERT_PHONE` |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS sender and inbound signature verification |
| `TWILIO_API_KEY_SID`, `TWILIO_API_KEY_SECRET` | Optional Twilio API-key authentication |
| `ADMIN_TOKEN`, `CRON_SECRET`, `UNSUB_SECRET` | Protected admin, cron and unsubscribe authorization; check helper names before provisioning |
| `ACCOUNTS_ENABLED` | `true` only after account migrations and release gates |
| `CARD_PAYMENTS_OFF`, `VITE_CARD_PAYMENTS_OFF` | Server/browser emergency payment stop |
| `CLOSE_ORDER_VERIFY_MS` | Optional close-order verification timeout |
| `MENU_SYNC_ALLOW_SHRINK` | Explicit override for a known legitimate catalog shrink |
| `VITE_CLOVER_SDK_URL` | Optional Clover SDK URL override; must also be allowed by CSP |

Confirmed digest address: `gigispizzalb@gmail.com`. Lost-order phone: Tommy (configured in Vercel).
Contact environment updates were submitted during this task; deployment is still required
for the release to use them. Do not confuse a configured SMS number with confirmed carrier
registration or proof of receipt. Test delivery only with the owner's explicit authorization.

Neon integration variables such as `DATABASE_URL_UNPOOLED`, `NEON_AUTH_BASE_URL`,
`VITE_NEON_AUTH_URL`, `NEON_PROJECT_ID`, `PG*` and `POSTGRES_*` are not the custom account
implementation's credentials. Leave integration-managed settings alone; never publish them.

## Release checklist

- Run both TypeScript checks, lint, tests, build and applicable price/static/CSP checks.
- Apply reviewed additive numbered migrations to the correct location database.
- Verify the sender domain for `DIGEST_FROM` and confirm needed provider variables exist.
- Enable account routes only with the migration and matching frontend deployment.
- Verify public pages, login shell and API method/error behavior without customer messages.
- Record actual deployment URL/commit and any remaining staff hardware checks.


