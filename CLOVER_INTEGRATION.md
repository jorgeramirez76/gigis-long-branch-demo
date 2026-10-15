# Clover integration — Long Branch

Updated 2026-09-12. The former Slice/hosted-Clover link-out plan is retired.
The site at https://gigislongbranch.com uses its own menu, cart and prepaid checkout.

In-house ordering is always on in code; the old `ORDER_PROVIDER` / `VITE_ORDER_PROVIDER`
switches are no longer read (the emergency stop is `VITE_CARD_PAYMENTS_OFF`, see
`OPERATIONS-2026-09-12.md`). No `ORDER_ONLINE_URL` or `CLOVER_ORDER_URL` constant is used.
Slice remains a separate marketplace listing where present.

Clover-hosted secure fields tokenize card details; raw card details never reach this API.
The server prices the cart from the Clover catalog, reserves the order idempotency key,
creates an itemized Clover draft and verifies the total before paying and routing it.
Keep the draft pointer durable before payment. An uncertain capture must not invite a
second payment attempt. Use the persisted ledger and recovery tools to resolve it.

See `ORDERING.md` for operation and `OPERATIONS-2026-09-12.md` for environment variables.
Do not enable a hosted ordering channel or alter merchant/DNS settings as part of a code
release. Never test with real payments without a separately authorized supervised test.
