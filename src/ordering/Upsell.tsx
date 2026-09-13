import { useEffect, useState } from "react";
import { money, useCart } from "./CartContext";
import { findCatalogItem } from "../lib/menuPricing";

/**
 * In-cart upsell — three "add these to your order" suggestions with one-tap add.
 * Curated to quick-add items (no required options), high-margin impulse buys.
 *
 * Prices are RESOLVED from the catalog, never written here. Hardcoding them put two live
 * bugs in the cart: "Wing Dings (12 Pieces)" in a category that doesn't exist (the server
 * rejected the whole order with "Unknown item" the moment anyone tapped it), and Small Fries
 * offered at $4.16 while the register charged $5.15. A suggestion that can't be found in the
 * catalog is dropped rather than shown, so a shop-side rename can only ever cost an upsell.
 */
const SUGGESTIONS = [
  { itemName: "Garlic Knots", categoryId: "appetizers", tag: "Most added" },
  { itemName: "Mozzarella Sticks (6)", categoryId: "appetizers", tag: "Crowd favorite" },
  { itemName: "Cannoli (2)", categoryId: "desserts", tag: "Sweet finish" },
  { itemName: "French Fries Regular", categoryId: "french-fries", tag: "Classic side" },
  // Two Liter Soda is NOT quick-addable: its "Soda Choices" group is Choose 1, and a one-tap
  // add skips the modal that enforces it — the kitchen got paid tickets with no flavor picked.
];

export function Upsell({active}: {active?:boolean} = {}) {
  const cart = useCart();
  const visible = active ?? cart.isOpen;
  const [personalized, setPersonalized] = useState<{itemName:string;categoryId:string;basePrice:number;options:{group:string;name:string;delta:number;placement?:"whole"|"left"|"right"}[];impressionId:number}[]>([]);
  const cartNames = cart.lines.map(line => line.itemName).sort().join("\n");
  useEffect(() => {
    if (!visible) return;
    let active = true;
    fetch("/api/account/upsell", {method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({inCart:cartNames.split("\n")})})
      .then(async r => r.ok ? r.json() : null).then(data => {if(active)setPersonalized(data?.items || []);}).catch(()=>{});
    return () => {active=false;};
  }, [visible,cartNames]);
  const inCart = new Set(cart.lines.map((l) => l.itemName));
  const picks = personalized.length
    ? personalized.filter(s=>!inCart.has(s.itemName)).map(s=>({...s,options:s.options || [],tag:"You usually add this"})).slice(0,3)
    : SUGGESTIONS.flatMap(s=>{
      if(inCart.has(s.itemName)) return [];
      const item=findCatalogItem(s.itemName,s.categoryId);
      if(!item || item.basePrice<=0 || item.optionGroups.some(g=>/^choose [1-9]/i.test(g.rule || ""))) return [];
      return [{...s,basePrice:item.basePrice,options:[] as {group:string;name:string;delta:number;placement?:"whole"|"left"|"right"}[]}];
    }).slice(0,3);
  if (picks.length === 0) return null;

  return (
    <div className="border-t border-[var(--color-line)] bg-[var(--color-page)] px-5 py-4">
      <p className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--color-copy-muted)]">
        Add these to your order
      </p>
      <div className="space-y-2">
        {picks.map((s) => (
          <div
            key={s.itemName}
            className="flex items-center justify-between gap-3 rounded-xl bg-[var(--color-panel)] px-3.5 py-2.5 shadow-[var(--shadow-sm)]"
          >
            <div className="min-w-0">
              <p className="truncate font-serif text-sm font-semibold text-[var(--color-copy)]">{s.itemName}</p>
              <p className="text-[11px] text-[var(--color-copy-muted)]">
                {s.tag}{s.options.length ? ` · ${s.options.map(o=>o.name).join(", ")}` : ""} · <span className="font-semibold text-[var(--color-action-text)]">{money(s.basePrice+s.options.reduce((sum,o)=>sum+o.delta,0))}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => {
                cart.addLine({ itemName: s.itemName, categoryId: s.categoryId, basePrice: s.basePrice, options: s.options, quantity: 1 });
                const shown = personalized.find(item => item.itemName === s.itemName);
                if (shown) void fetch("/api/account/upsell-add",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({impressionId:shown.impressionId})});
              }}
              aria-label={`Add ${s.itemName}`}
              className="shrink-0 rounded-full border border-[var(--color-brand-red)] px-4 py-1.5 text-xs font-bold uppercase tracking-wide text-[var(--color-action-text)] transition hover:bg-[var(--color-brand-red)] hover:text-white"
            >
              + Add
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
