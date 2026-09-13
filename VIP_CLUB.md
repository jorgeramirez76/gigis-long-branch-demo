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
deletion anonymizes login data and order association while retaining required consent
and welcome-offer records. Never put raw passwords, tokens or full customer phones in logs.

Shared broadcast codes are register-only unless an explicit discount implementation is
added. They do not use the `PIE-` checkout redemption path.

Run the account/security, promo and checkout tests before enabling the release. Migrations
must precede activation. Do not claim that this local implementation is already live.
