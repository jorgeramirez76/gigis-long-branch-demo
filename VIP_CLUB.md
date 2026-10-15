# VIP and Gigi's Rewards — Long Branch

Updated 2026-09-12. Neon, Resend and Twilio integrations already exist; email is not a
stub. Membership and consent remain separate from password authentication.

The new `/account/` flow is implemented locally and gated by `ACCOUNTS_ENABLED=true`.
Signup collects name, email, phone, address/locality and explicit consent choices, sends
a verification email, and asks for the password after verification. Email is the username;
phone login is not offered without phone ownership verification. Accounts are per location.

Existing members use “Already a VIP?” to verify email and set a password. Their existing
member and welcome code are linked; this must never mint another code for the same member.
The member's `PIE-` code is for one eligible plain pie, pickup only, with a 90-day expiry.
The server reserves it before charging and marks it redeemed after capture; used codes
remain visible as Used and cannot be redeemed again. Address/phone/email identity guards
continue to limit the welcome offer to one household.

The dashboard shows saved addresses, code status, order history, reorder and consent
controls. Guest orders can be attached only after email verification. Personalized
suggestions use prior paid orders and current catalog availability. Guests keep the
curated add-on suggestions. Prices are always recalculated from the current catalog.

SMS requested is not SMS confirmed: a YES reply is required before marketing SMS.
Unsubscribe works without a login. Password-reset emails are transactional. Account
deletion anonymizes login data and order association, switches off the linked member's SMS
and email consent (recorded as `account_delete` opt-outs, email suppressed), and retains required
consent and welcome-offer records. Expired sign-in links and sessions are pruned daily. Never put raw passwords, tokens or full customer phones in logs.

Shared broadcast codes are register-only unless an explicit discount implementation is
added. They do not use the `PIE-` checkout redemption path.

Scheduled blasts are sent by `api/cron/send-scheduled.ts`, which ticks every 20 minutes and does
its work only during the counter's hours (`api/lib/cronHours.ts`: Mon-Wed 10 AM-11 PM, Thu-Sun
10 AM-midnight Eastern). A blast goes out at the first tick at or after its send time, so up to
20 minutes late; one queued for overnight goes out at the 10 AM tick. The gate ignores
`CLOSED_DATES` on purpose, so a blast queued for a closed day (the "closed today" notice) still
goes out that day. Text blasts may only START between 9 AM and 8:30 PM Eastern
(`api/lib/smsWindow.ts`). Outside that window the dashboard refuses a blast with a text leg
(email-only blasts are fine), and a scheduled blast with a text leg waits unclaimed for the next
tick inside the window. The dry run also warns when people on the text list already got 4+ texts
in the last 30 days.

Each blast runs inside one function call of at most 800 seconds (`BLAST_RUN_LIMIT_SEC`). Emails go
out one at a time (~0.9 s each, under Resend's rate limit), so one run fits roughly 650 email
members with room to spare. The dry run estimates the send time and warns when a list no longer
fits; at that point switch email fan-out to Resend's batch endpoint before sending. A blast killed
mid-list is not resumed automatically: it stays reserved for staff review (no double sends).

Accounts are live (production release `65df7d0`). For later changes, run the account/security,
promo and checkout tests first; migrations must precede activation of anything that needs them.
