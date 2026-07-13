import { useCart } from "./CartContext";

/** Cart trigger with live item count. Place in the nav / sticky bar. */
export function CartButton({
  variant = "red",
  label = "Order",
  className = "",
}: {
  variant?: "red" | "gold";
  label?: string;
  className?: string;
}) {
  const cart = useCart();
  const styles =
    variant === "gold"
      ? "bg-[var(--color-gold-bright)] text-[var(--color-ink)] hover:bg-[var(--color-gold)]"
      : "bg-[var(--color-brand-red)] text-white shadow-[var(--shadow-red)] hover:bg-[var(--color-brand-red-bright)]";
  const badge =
    variant === "gold"
      ? "bg-[var(--color-brand-red)] text-white"
      : "bg-[var(--color-gold-bright)] text-[var(--color-ink)]";

  return (
    <button
      type="button"
      onClick={cart.openCart}
      aria-label={`Open your order, ${cart.count} item${cart.count === 1 ? "" : "s"}`}
      className={`relative inline-flex items-center gap-2 rounded-full px-4 py-2.5 text-sm font-bold uppercase tracking-wide transition ${styles} ${className}`}
    >
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 6h15l-1.5 9h-12z" />
        <circle cx="9" cy="20" r="1" />
        <circle cx="18" cy="20" r="1" />
        <path d="M6 6 5 3H3" />
      </svg>
      {label}
      {cart.count > 0 && (
        <span className={`absolute -right-1.5 -top-1.5 flex h-5 min-w-[20px] items-center justify-center rounded-full px-1 text-[11px] font-extrabold ${badge}`}>
          {cart.count}
        </span>
      )}
    </button>
  );
}
