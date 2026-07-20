/**
 * MENU — generated from Gigi's Long Branch live Clover POS inventory on 2026-07-12.
 *
 * Source of truth: data/clover/classified/*.json — every customer-facing item,
 * price, and modifier (toppings, half-pie charges, add-protein, bread/sauce
 * choices) mirrors the Clover dashboard exactly. Internal/duplicate/ghost-kitchen
 * items are excluded. Raw dump: data/clover/clover-menu-dump.json.
 *
 * Regenerate after any Clover menu change:
 *   python3 scripts/pull-clover.py      # re-pull inventory (needs .env token)
 *   python3 scripts/build-menu.py       # rebuild this file's source
 *
 * Do not hand-edit menuGenerated.ts — edit the classification data or the
 * generator, then re-run it.
 */
import { MENU_GENERATED } from "./menuGenerated";
import type { MenuCategory } from "./menuTypes";

export type { MenuItem, MenuCategory, OptionGroup, OptionChoice } from "./menuTypes";

export const MENU: MenuCategory[] = MENU_GENERATED;

export const MENU_VERIFIED = true;

export const PRICING_DISCLAIMER =
  "This menu mirrors our in-store menu. Listed prices are card prices — choose Cash at checkout (or pay cash in store) and get a 3.99% discount. Prices and availability can change — your final total is confirmed when you order. Questions? Call 732-377-2468.";
