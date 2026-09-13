# Online ordering — Gigi's Long Branch

Updated 2026-09-12. All website orders are prepaid by card or Apple Pay. There is no
website pay-at-counter, cash or pay-at-pickup fallback. The public shop phone is 732-377-2468.
Online ordering closes at 11 PM daily; the counter stays open to midnight Thursday–Sunday.

## Order flow and recovery

The menu is generated from the merchant's current Clover inventory; do not hardcode
an item count or price from an old handoff. The browser selects items and modifiers;
`api/order/create.ts` recalculates prices, checks the expected total and validates
fulfillment, Turnstile and request limits. Card data stays inside Clover secure fields.
The ledger tracks the idempotency key, totals, order items, draft/payment pointers and
routing/printing state. Confirmed orders can later be associated with a verified account.

Payment uncertainty is distinct from a decline. An uncertain attempt stays locked until
its existing order status is resolved; never ask the customer to pay again blindly.
A captured but unrouted order needs staff recovery. An unknown printer response does not
prove a ticket failed. Alerts are deduplicated, and failed SMS delivery can use the email
fallback. Scheduled sweeps also check the final order of the evening.

An OPEN Clover ticket can be an orphaned draft or an incident leftover. It does not prove
money is owed. **Do not collect again** without reconciling the payment and website ledger.
Use protected order-status/recovery tools and retain an incident record for manual actions.

## Configuration and testing

Production has in-house ordering and Clover secure fields enabled. Apple Pay requires the
existing verified merchant/domain configuration and `VITE_CLOVER_APPLE_PAY=1`. Turnstile
requires the public site key and private verification key. Missing payment configuration
must stop checkout, rather than accepting an unpaid website order.

Use the checks in `README.md`, fixture-based provider tests and the build gates. Do not
send production payments, refunds, SMS or emails as an automated smoke test. Real register
printing and alert receipt require a separately coordinated staff check.

The September 12 changes, including accounts, remain a local release candidate until the
main task records a successful deployment. See `OPERATIONS-2026-09-12.md`.
