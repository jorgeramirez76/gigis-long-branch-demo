# Gigi's NY Style Pizza — Long Branch

## What it is
A family-run New York-style pizzeria and Italian restaurant at **140 Brighton Avenue**, in the
West End of **Long Branch, NJ 07740**. Phone **(732) 377-2468**. Open 7 days: Mon–Wed 10 AM–11 PM,
Thu–Sun 10 AM–midnight. Operated by GIGIS NY STYLE PIZZA LONG BRANCH LLC. Owner-operators: Tommy
Basile and Kenneth Gambella.

The website (gigislongbranch.com) is a real ordering business, not a brochure: online ordering
wired to the shop's own Clover POS, prepaid card/Apple Pay, kitchen-ticket printing, emailed
receipts, and a VIP text/email club. ~$500 of real customer orders in its first two weeks.

## The unique mechanism
An independent neighborhood pizzeria running its own ordering stack — no Slice, no DoorDash
middleman taking a cut. Orders print in Gigi's kitchen and money lands in Gigi's account.

## Surfaces
- `/` — the restaurant: menu, ordering, breakfast, VIP club.
- `/pizza-party-long-branch/` — **kids' make-your-own-pizza birthday parties** (this brief).
- Local SEO landing pages (late-night, gluten-free, vegan, catering, delivery by neighborhood).
- `/admin.html` — staff CRM: members, blasts, free-pie code redemption.

## The pizza-party offer (verified from the owner's flyer + photos)
- "Make Your Own Pizza" birthday party. **Packages start at $15 per person.**
- Each child rolls their own dough, adds sauce, cheese and their favorite toppings, watches their
  personal pizza bake, and gets a full pizza-making lesson from the chef.
- Upgrades: personalized chef hats, personalized aprons, an "I'm a Gigi's Pizza Maker" t-shirt,
  and an "I'm a Gigi's Pizza Maker" certificate.
- Held in the restaurant. Real photos exist of kids in paper chef hats at a long party table, a
  chef handing a child their pizza, and a group in front of the shop's painted pizza-wings mural.
- **Booking is by phone only.** There is no online booking form. Success = a phone call.

### Not established (never state as fact)
Party length, minimum/maximum guest count, deposit, age range, what exactly each package tier
includes beyond the above, weekend availability. All of these route to "call and we'll build it
around your date and headcount."

## Audience for the party page
A parent — most often a mom — in Long Branch/Monmouth County planning a 5–10 year old's birthday,
usually on a phone, often at night. She is comparing Gigi's against trampoline parks, bowling
alleys and doing it at home. She needs to believe her kid will have a genuinely good time, that
it is affordable, and that booking is one easy call.

## Brand commitments (pinned by the owner — do not replace)
- Colors: red `#9b121a`, cream `#faf2e1`, gold `#c89441`, ink `#1a1210`, Italian green `#008751`.
- Type: **Bebas Neue** display, **Playfair Display** serif, **Inter** body.
- Logo: the round Gigi's "New York Style Pizza & Restaurant" mark.
- Physical world of the shop: a lit **GIGI'S marquee-bulb sign** on the wall, a painted
  pizza-slice-wings mural, string café lights, brick wainscot, terrazzo floor.
- The shop's own party flyer is **black-ground**, with red/white/green chalk lettering, a
  chalkboard upgrades panel and a pizza-slice motif.

## Technical constraints
Static HTML + inline `<style>` only on landing pages. **No JavaScript** (site CSP allows no inline
script). Must not touch the React ordering app. Mobile-first — the highest-intent traffic is a
parent on a phone. All calls-to-action are `tel:+17323772468`.
