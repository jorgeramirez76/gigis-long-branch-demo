/**
 * Send the customer to the menu, from anywhere on the site.
 *
 * Reported 2026-08-08: tapping "Order" opened the cart, and the empty cart's
 * "Browse the menu" button only CLOSED the drawer — leaving the customer exactly where
 * they started, with the #menu anchor still ~8,000px down the home page. Order → empty
 * cart → "Browse the menu" → back to square one, never having seen a single item.
 *
 * The menu lives at #menu on the home page only, so from any other route (/breakfast,
 * /catering…) this has to be a real navigation, not a scroll.
 */
export function goToMenu(): void {
  if (typeof window === "undefined") return;
  const target = document.getElementById("menu");
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    // Keep the URL honest so back/refresh/share land on the menu too.
    history.replaceState(null, "", "#menu");
    return;
  }
  window.location.href = "/#menu";
}
