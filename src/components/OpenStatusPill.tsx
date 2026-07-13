import { useEffect, useState } from "react";
import { getOpenStatus, type OpenStatus } from "../lib/openStatus";

/** Live "Open now / Closed" pill. Computed client-side (time-dependent), so it
 * renders nothing on the server/first paint, then fills in — no SSR mismatch. */
export function OpenStatusPill({ className = "" }: { className?: string }) {
  const [status, setStatus] = useState<OpenStatus | null>(null);
  useEffect(() => {
    const tick = () => setStatus(getOpenStatus());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);
  if (!status) return null;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <span
        className={`inline-block h-2 w-2 rounded-full ${status.open ? "bg-emerald-400" : "bg-red-400"}`}
        style={status.open ? { boxShadow: "0 0 8px rgba(52,211,153,0.9)" } : undefined}
      />
      {status.label}
    </span>
  );
}
