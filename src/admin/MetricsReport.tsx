import { useState } from "react";
import { api } from "./api";
type Report = { events: { day: string; event: string; source: string; n: number }[]; orders: { day: string; accepted_orders: number; recorded_captures: number; unresolved_orders: number }[]; definitions: Record<string, string> };
export function MetricsReport() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function download() {
    setBusy(true); setMessage("");
    try {
      const report = await api<Report>("/api/admin/metrics");
      const rows = [["date", "kind", "source", "count"], ...report.events.map(r => [r.day, r.event, r.source, r.n]), ...report.orders.flatMap(r => [[r.day, "accepted_orders", "not_attributed", r.accepted_orders], [r.day, "recorded_captures", "not_attributed", r.recorded_captures], [r.day, "unresolved_orders", "not_attributed", r.unresolved_orders]])];
      const csv = rows.map(row => row.map(v => JSON.stringify(String(v))).join(",")).join("\r\n");
      const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
      const a = document.createElement("a"); a.href = url; a.download = "gigis-website-actions.csv"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMessage(report.events.length ? "Report downloaded." : "Report downloaded. No website actions recorded in this period.");
    } catch { setMessage("Website report is unavailable. Ordering is unaffected."); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border bg-white p-4 text-slate-900">
    <h2 className="font-bold">Website activity</h2>
    <p className="my-2 text-sm">Download the past 28 days plus today. Action counts are best effort, once per action type per page visit. They are not unique people or completed calls. Order totals come from the order ledger and are not attributed to a traffic source; accepted orders are not proof of fulfillment or net revenue.</p>
    <button type="button" onClick={() => void download()} disabled={busy} className="rounded border px-3 py-2 text-sm font-semibold">{busy ? "Preparing report…" : "Download website activity CSV"}</button>
    <p role="status" className="mt-2 text-sm">{message}</p>
  </section>;
}
