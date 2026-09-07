"""
Python twin of api/lib/cardPricing.mjs — the rule that turns a register price (4% baked in by
the cash-discount program) into the cash price the menu shows. The generators in this folder
are Python and the order API is JavaScript, so the rule exists twice; tests/card-pricing.test.ts
runs both over the same inputs and fails if they ever disagree. Change both or neither.
"""
CARD_PRICING_RATE = 0.04


def _strong(cents: int) -> bool:
    last = cents % 100
    return cents % 25 == 0 or last == 95 or last == 99


def _weak(cents: int) -> bool:
    return cents % 5 == 0 or cents % 10 == 9


def menu_price_cents(register_cents: int) -> int:
    cents = int(round(register_cents or 0))
    if cents <= 0:
        return cents
    stripped = int(round(cents / (1 + CARD_PRICING_RATE)))
    if _strong(stripped):
        return stripped
    if _strong(cents):
        return cents
    if _weak(cents) and not _weak(stripped):
        return cents
    return stripped


def card_pricing_cents(food_cents: int) -> int:
    return int(round(max(0, food_cents or 0) * CARD_PRICING_RATE))


if __name__ == "__main__":
    import sys
    print(" ".join(str(menu_price_cents(int(a))) for a in sys.argv[1:]))
