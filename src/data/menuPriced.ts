import { MENU_GENERATED } from "./menuGenerated.js";
import { withToppingCharges } from "./menuToppings.js";
import type { MenuCategory } from "./menuTypes.js";

/**
 * The menu as the site actually sells it: the generated Clover mirror with
 * topping charges folded in (see menuToppings.ts).
 *
 * Everything reads THIS — the browser's menu and item modal, the shared price
 * table in src/lib/menuPricing.ts that the order API re-prices from, and the
 * nightly refresh that writes /api/menu's snapshot — so a topping cannot be free
 * in one of them and $3.12 in another.
 *
 * Explicit .js specifiers: this module is bundled into the serverless functions,
 * where Node's ESM loader will not resolve an extensionless path.
 */
export const MENU_PRICED: MenuCategory[] = withToppingCharges(MENU_GENERATED);
