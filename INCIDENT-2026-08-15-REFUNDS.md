# Refund worksheet — website double-charge incident (Aug 12–15, 2026)

**What happened:** from the evening of Aug 12 until ~5:45 PM Aug 15, the website's payment code
misread Clover's "payment succeeded" reply as a decline. Customers were charged, shown
"Card was declined," and naturally tried again — so several were charged more than once.
**Fixed and verified Aug 15 ~5:41 PM.** No kitchen tickets printed for any of these because the
misread stopped the order from ever firing.

Every amount below was read directly from Clover's payment records (payment IDs included so they
can be found instantly in the Clover dashboard under Transactions).

## REFUNDS TO ISSUE — total $171.89

### Gianni — (908) 340-8870 — refund $111.44 (4 payments)
Charged 5 times between 5:26 and 5:31 PM on Aug 15 while re-trying (he even switched cards
mid-way believing his card was bad). His **last** charge is the legitimate one — order
SSH58ABJX0VPY, $29.11, KEEP that one.

| Refund | Amount | Payment ID | Card |
|---|---|---|---|
| 1 | $26.61 | 7VZMKVN1GZHF0 | …5166 |
| 2 | $26.61 | 6Q2JQBPJEMFDA | …5166 |
| 3 | $29.11 | XD2YN6594KQYA | …5166 |
| 4 | $29.11 | A81ADAVSXFCAT | …6089 |

### Austen Fradeneck — (814) 414-6526 — refund $60.45 (1 payment)
Double-charged on **Aug 12 at 8:03 PM** (8 seconds apart, same card …0857) — the first victim,
outstanding for 3 days. His first charge (order RE7MCCSAYXE8T, delivered to 320 Long Branch Ave)
is the legitimate one — KEEP it.

| Refund | Amount | Payment ID |
|---|---|---|
| 1 | $60.45 | 6W1VHKKHGB2Z4 |

### Sarah — (717) 538-4465 — TOMMY MUST CHECK: she now has TWO live charges
Charged 3× $36.97 on Aug 15 by the website. Tommy voided two at the store, leaving web payment
**44RK6ZKMBSS80** ($36.97, live, not refunded).

**Then at 5:53 PM a second $36.97 went through in-store** — payment **CQKD84H7KJAH4**, tapped card
(VISA …5370) on the counter device, rung onto her leftover website order 9RSH1F4QM6ZDM. That order
now shows locked/PAID. So two live $36.97 charges exist for one order's worth of food.

Only Tommy knows which is right:
- If Sarah paid again at the counter because the site said "declined" → refund one of the two.
- If that 5:53 charge was a walk-in customer accidentally rung onto her leftover order → nothing to
  refund, but the ticket belongs to someone else.

*(Verified against Clover at 6:30 PM Aug 15: both payments SUCCESS, zero refunds on either.)*

## POS CLEANUP (no money involved)
- **Do NOT delete order 9RSH1F4QM6ZDM** — it is now PAID (see Sarah above). The earlier version of
  this sheet said to close it; that was written before the 5:53 PM in-store charge landed on it.
- Delete/close Sarah's other leftover order **94JX292NHR6QW** — still open and unpaid at $36.97
  as of 6:30 PM Aug 15 (kitchen could mistakenly make it).
- Close staff-keyed order **823** (T3GQ2XNJ4MW16, $26.61, open/unpaid — hand-entered for Gianni
  at the register mid-incident). It may already be gone.
- Six paid website orders sit as invisible drafts in Clover (they don't appear in the Orders
  screen; find them via the payments above). After refunds they can be ignored.

## GOOD-WILL SUGGESTION
Gianni and Austen both had genuinely bad experiences (Gianni tried 6 times and switched cards).
Each has a VIP free-pie–sized apology available if you want it — say the word and codes can be
issued to them.
