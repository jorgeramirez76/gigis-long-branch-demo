import { useEffect, useState } from "react";
import { MENU } from "../data/menu";
import type { MenuCategory, MenuItem } from "../data/menuTypes";

/** The snapshot decides WHICH items are on the menu (reconciled against Clover nightly); the
 * build decides what can be chosen on them. Options ride along in the snapshot only because it
 * is a copy of the menu as of its last write, so between a deploy that changes a topping list
 * and the next 4 AM refresh it would still offer choices the order API — which prices from the
 * static catalog — no longer knows: a topping pulled from the menu could be ticked here and then
 * refused at checkout as unknown. Items the build has never seen keep the snapshot's options. */
export function withStaticOptions(live: MenuCategory[]): MenuCategory[] {
  const byKey = new Map<string, MenuItem>();
  for (const c of MENU) for (const it of c.items) byKey.set(c.id + "\0" + it.name, it);
  return live.map((c) => ({
    ...c,
    items: c.items.map((it) => {
      const built = byKey.get(c.id + "\0" + it.name);
      return built ? { ...it, options: built.options } : it;
    }),
  }));
}

// Every consumer on this page resolves the same snapshot. The static catalog
// renders immediately and remains available if the API is unavailable or returns 204.
let snapshot: Promise<MenuCategory[]> | undefined;
export function getMenuSnapshot(): Promise<MenuCategory[]> {
  snapshot ??= fetch("/api/menu", { signal: AbortSignal.timeout(5000) })
    .then(response => response.ok && response.status !== 204 ? response.json() : null)
    .then(data => {
      if (!Array.isArray(data?.categories) || !data.categories.length) return MENU;
      const categories = data.categories as MenuCategory[];
      if (!categories.every(category => category && typeof category.id === "string" && Array.isArray(category.items))) return MENU;
      return withStaticOptions(categories);
    })
    .catch(() => MENU);
  return snapshot;
}

export function useMenu(): MenuCategory[] {
  const [menu, setMenu] = useState<MenuCategory[]>(MENU);
  useEffect(() => {
    let alive = true;
    void getMenuSnapshot().then(categories => { if (alive) setMenu(categories); });
    return () => { alive = false; };
  }, []);
  return menu;
}
