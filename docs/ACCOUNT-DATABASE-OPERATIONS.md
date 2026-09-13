# Account and database operations — Long Branch

This runbook describes the September 2026 account release and its reviewed code. It contains no credentials or customer records. Confirm the live deployment, database branch, and configuration before any maintenance; a passing unit test is not proof that a production email or restore works.

## Location boundary and configuration

| Setting | This location |
| --- | --- |
| Production origin | https://gigislongbranch.com |
| Account business key | `gigis_long_branch` |
| Neon project | `holy-bar-54247162` |
| Database engine observed | PostgreSQL 17 |
| Plan observed | Free (`free_v3`) |
| Recovery history observed | 21,600 seconds: six hours |
| Storage limit observed | 512 MB |

Sea Bright and Long Branch have separate Neon projects, Vercel configuration, customer records, and Clover integrations. Do not substitute the other location's connection string, provider credentials, or business key. Production project information was inspected during release review; reported database usage was approximately 34 MB. Recheck current capacity in Neon before migrations or importing records.

Required server configuration: `DATABASE_URL`, `ACCOUNTS_ENABLED=true`, `RESEND_API_KEY`, `EMAIL_FROM`, and `TURNSTILE_SECRET_KEY`. `VITE_TURNSTILE_SITE_KEY` supplies the public verification widget key. `EMAIL_FROM` must be an authorized sender. Existing Twilio configuration supports optional SMS consent requests; staff alert and digest destinations remain location-specific. Keep secrets in deployment configuration, never in this document, source control, screenshots, or logs. The account origin is pinned in `api/lib/session.ts`; preview hosts need deliberate configuration and must not use production credentials for testing.

## Schema changes

`db/migrations/` contains ordered migrations. This location currently ends at `007_broadcast_reservations.sql`. `db/schema.sql` is the consolidated fresh-database schema; it is not an instruction to recreate a production database.

| Migration | Purpose |
| --- | --- |
| 001 | Normalize member identity and support rate counters. |
| 002 | Persist the website order ledger and its amounts. |
| 003 | Accounts, hashed sessions/reset tokens, addresses, order lines, upsell history, and credential versions. |
| 004 | Durable pending enrollment and one default saved address per account. |
| 005 | Enforce one welcome reward per member and business. |
| 006 | Allow both marketing channels to be off without deleting membership. |
| 007 | Reserve broadcast requests and content before provider delivery. |

Before applying a change, inspect the target schema and existing indexes/constraints. Check duplicates before adding uniqueness. Review each migration's actual SQL: `006` removes an obsolete consent constraint, and migrations must not be treated as universally additive or safe to rerun blindly. Record the migration filenames, deployed commit, project/branch, execution time, and validation result in the release record. There is no automatic migration history runner promised by this runbook.

First apply the migration to an isolated branch of the correct location. Keep outbound email, SMS, Clover payment, and kitchen-print integrations disabled or mocked there. Use a new empty isolated database to validate the consolidated schema separately. Do not reset or drop production tables to make a migration pass.

## Security and data integrity

- Passwords are salted bcrypt hashes, not recoverable plaintext. The API requires at least 12 characters and rejects bcrypt input above 72 UTF-8 bytes. Support cannot retrieve or email an existing password.
- Email ownership is proved before creating an account or claiming a legacy membership. Email is the normalized username. Reset tokens use 32 random bytes; only a SHA-256 hash is stored, with a 30-minute expiry and single-use marker. The browser receives the token in a URL fragment.
- Reset token consumption and credential changes share one SQL statement. Reset increments `credential_version`, revokes previous sessions, and invalidates other unused links. Session creation checks the expected password hash so a concurrent reset cannot create a valid stale session.
- Sessions use random tokens stored hashed in the database. Cookies are `HttpOnly`, `Secure`, `SameSite=Lax`, and scoped to the host. Sessions expire after 30 days with sliding renewal. Account writes require the pinned origin and JSON content type; sensitive entry points require verification and rate limits.
- Account history and reordering filter by both account and business. Guest-order linking uses the account's verified email. Reorder prices come from the current catalog; customer-supplied prices are not authoritative. Replacing an existing saved cart requires confirmation.
- A unique database index prevents a second welcome reward for the same member. Redemption requires an unredeemed code and its matching order reservation. Used codes remain visible as used and cannot be redeemed again. Phone and household checks supplement account identity; these do not prove a physical address.
- Reward holds have no automatic timeout. An uncertain payment may have captured; clearing its hold without reconciling the payment can issue a second free pie. Staff recovery must establish the payment/order outcome before release.
- Foreign keys link accounts, sessions, addresses, orders, and line items. Unique `(order_id, line_index)` entries and the history trigger prevent duplicate line history on status changes. `enrollment_payload` lets sign-in finish an interrupted membership enrollment without requiring a second signup.
- Account deletion removes sign-in access, saved addresses, pending links/enrollment, and upsell impressions, and detaches account history. Order and consent audit records are retained; deletion is not a purge of all business records.

These controls were reviewed and tested. They are not a claim of independent security certification, complete fraud prevention, or guaranteed availability.

## Password or membership support

Direct the customer to `/account/` → **Forgot password?**. After opening a link, **Request a new password link** remains available if the link expired. Never ask staff to set a password in SQL or disclose a token. The response intentionally does not reveal whether an email has an account.

If mail does not arrive, check the authorized sender and provider delivery status, then rate-limit and API errors. Avoid repeated sends to a customer while diagnosing. A 503 may mean email, verification, or database infrastructure is unavailable; it does not justify bypassing email ownership checks.

If a customer chose a password but enrollment was interrupted, have them sign in. The durable enrollment path retries linkage and missing-code recovery. A redeemed or expired reward must not be replaced merely to make the dashboard look successful. Household matches that cannot be safely resolved require staff review.

## Recovery procedure — validate off production first

1. Record incident time in UTC, affected location, deployment commit, symptoms, and the last known good state. Preserve evidence without copying passwords, reset links, customer records, or provider credentials into a public incident log.
2. Inspect Neon availability, storage, branch identity, and retention window. The observed six-hour window is short; do not assume yesterday's state is recoverable.
3. Create an isolated recovery branch from an available point before the incident. If that point is outside retained history, identify an existing verified backup; do not claim a backup exists merely because Neon supports recovery features.
4. Validate schema, indexes, foreign keys, migration compatibility, record counts, paid-order totals, reward redemption/holds, and account/order linkage in that branch. Reconcile payment outcomes against the provider before changing any payment-related record. A database rollback cannot reverse a real card charge, delivered message, or printed ticket.
5. Run the tests below with synthetic data and mocked providers. Check account sign-in/reset and authorization in a nonproduction environment. Test an actual restore and record recovery duration and any lost interval before calling the backup process proven.
6. Prepare a reviewed cutover/reconciliation plan. Reconcile writes made after the recovery point, invalidate restored sessions/reset links where necessary, and verify the correct deployment connection. Do not swap production connections, overwrite production, or delete a branch as part of an exploratory test.
7. After an authorized production change, check public account routes and unauthenticated access, then monitor errors and missing-order/reward reports. Keep a rollback plan that accounts for writes made during recovery.

No backup restore drill was performed during this release review. Recovery time and achievable data-loss objectives are therefore unproven. The current six-hour history is not a seven-day backup policy. Recommended next operational step: arrange at least seven days of retained recovery history on an appropriate paid plan, verify the actual configured window, and document/test an independent backup and restore process. This recommendation has not been configured or purchased by this runbook.

## Validation and monitoring

Relevant current tests:

- `tests/account-security.test.ts`: password hashing, session/origin boundaries, private history, reset/deletion races, and duplicate SMS preference saves.
- `tests/account-password-reset.test.ts`: generic reset response, hashed expiring email tokens, credential/session revocation, and expired-link UI recovery.
- `tests/account-reorder-cart.test.ts`: accept/cancel behavior for replacing a saved cart.
- `tests/rewards-database.sql`: isolated-branch reward uniqueness, reservation ownership, used-code rejection, order-history capture, and credential-version rejection. It inserts synthetic fixtures inside a rolled-back subtransaction. Run it only against an explicitly selected test branch, not production.

The three account TypeScript test files passed 16 tests per location in the latest focused review. The SQL checks and fresh-schema work must retain their own dated branch validation records; this test count is not a live production guarantee.

```sh
npx tsx --test tests/account-security.test.ts tests/account-password-reset.test.ts tests/account-reorder-cart.test.ts
npx tsc -p tsconfig.api.json
npm run lint
npm test
npm run build
```

Use local/mock configuration for tests. Do not use a real purchase or customer signup as an automated health check. Safe public checks are GET `/account/` (200 HTML), GET `/api/account/config` (200 JSON with public key/consent text), and GET `/api/account/me` without cookies (401 `sign_in_required`). Account API responses must be `no-store`; never log the key or customer payload unnecessarily.

Monitor database storage against the 512 MB limit, retention settings, API 5xx/rate-limit trends, reset-email delivery failures, pending enrollment failures, unresolved paid-order/print states, and reward reservations awaiting reconciliation. Review failed scheduled digests and staff alert delivery; no alert should be treated as proof that every check ran. Assign an operator and escalation contact for outages. Confirm monitoring/backup coverage in the provider settings rather than assuming that documentation or a scheduled job alone provides it.
