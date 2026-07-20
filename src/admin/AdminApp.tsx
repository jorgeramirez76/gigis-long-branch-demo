import { useCallback, useEffect, useState } from "react";
import {
  api,
  ApiError,
  BUSINESSES,
  clearToken,
  getToken,
  setToken,
  type Business,
  type BroadcastRow,
  type Member,
  type Stats,
} from "./api";

type Tab = "overview" | "members" | "blast" | "history";

export function AdminApp() {
  const [authed, setAuthed] = useState<boolean | null>(null);
  const [business, setBusiness] = useState<Business>("gigis_long_branch");
  const [tab, setTab] = useState<Tab>("overview");
  const [stats, setStats] = useState<Stats | null>(null);

  const loadStats = useCallback(async () => {
    try {
      const data = await api<Stats>(`/api/admin/stats?business=${business}`);
      setStats(data);
      setAuthed(true);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setAuthed(false);
      else if (err instanceof ApiError && err.status === 503) setAuthed(false);
      else setAuthed(true); // DB errors etc. shouldn't lock the UI
    }
  }, [business]);

  useEffect(() => {
    if (getToken()) void loadStats();
    else setAuthed(false);
  }, [loadStats]);

  if (authed === null) return <Shell><p className="p-8 text-sm text-[var(--color-ink-mute)]">Loading…</p></Shell>;
  if (!authed) return <Login onSuccess={() => void loadStats()} />;

  return (
    <Shell
      header={
        <div className="flex flex-wrap items-center gap-3">
          <select
            value={business}
            onChange={(e) => setBusiness(e.target.value as Business)}
            className="rounded-lg border border-[var(--color-cream-darker)] bg-white px-3 py-2 text-sm font-semibold"
          >
            {BUSINESSES.map((b) => (
              <option key={b.value} value={b.value}>{b.label}</option>
            ))}
          </select>
          <button
            onClick={() => { clearToken(); setAuthed(false); }}
            className="ml-auto text-xs font-semibold text-[var(--color-ink-mute)] underline"
          >
            Log out
          </button>
        </div>
      }
    >
      <nav className="mb-6 flex gap-1 overflow-x-auto rounded-xl bg-white p-1 shadow-[var(--shadow-sm)]">
        {(
          [
            ["overview", "Overview"],
            ["members", "Members"],
            ["blast", "Send a Blast"],
            ["history", "History"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`shrink-0 rounded-lg px-4 py-2 text-sm font-bold transition ${
              tab === key
                ? "bg-[var(--color-brand-red)] text-white"
                : "text-[var(--color-ink-soft)] hover:bg-[var(--color-cream)]"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {tab === "overview" && <Overview stats={stats} business={business} onRefresh={loadStats} />}
      {tab === "members" && <Members business={business} />}
      {tab === "blast" && <Blast business={business} stats={stats} onSent={loadStats} />}
      {tab === "history" && <History business={business} />}
    </Shell>
  );
}

function Shell({ children, header }: { children: React.ReactNode; header?: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-[var(--color-cream)]">
      <header className="bg-[var(--color-brand-red)] px-4 py-5 text-white">
        <div className="mx-auto max-w-4xl">
          <h1 className="text-3xl tracking-wide">GIGI'S VIP CLUB — ADMIN</h1>
          <p className="text-xs uppercase tracking-widest text-[var(--color-gold-bright)]">
            Members · Texts · Emails · Promos
          </p>
        </div>
      </header>
      <div className="mx-auto max-w-4xl px-4 py-6">
        {header && <div className="mb-5">{header}</div>}
        {children}
      </div>
    </div>
  );
}

function Login({ onSuccess }: { onSuccess: () => void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setToken(value.trim());
    try {
      await api(`/api/admin/stats?business=gigis_long_branch`);
      onSuccess();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        clearToken();
        setError("That token didn't work.");
      } else if (err instanceof ApiError && err.status === 503) {
        clearToken();
        setError("Admin isn't configured on the server yet (ADMIN_TOKEN env var missing).");
      } else {
        // Token accepted but something downstream (e.g. the database) is
        // unhappy — let the app load and show the real problem.
        onSuccess();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <Shell>
      <form onSubmit={submit} className="mx-auto mt-10 max-w-sm space-y-4 rounded-2xl bg-white p-6 shadow-[var(--shadow-md)]">
        <h2 className="text-2xl">Sign in</h2>
        <input
          type="password"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Admin token"
          className="w-full rounded-xl border border-[var(--color-cream-darker)] px-4 py-3"
          autoFocus
        />
        {error && <p className="text-sm text-[var(--color-brand-red-bright)]">{error}</p>}
        <button
          disabled={busy || !value.trim()}
          className="w-full rounded-full bg-[var(--color-brand-red)] py-3 font-bold text-white disabled:opacity-50"
        >
          {busy ? "Checking…" : "Sign in"}
        </button>
      </form>
    </Shell>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)]">
      <div className="text-xs font-bold uppercase tracking-wider text-[var(--color-ink-mute)]">{label}</div>
      <div className="mt-1 text-3xl font-extrabold text-[var(--color-ink)]">{value}</div>
      {sub && <div className="mt-1 text-xs text-[var(--color-ink-mute)]">{sub}</div>}
    </div>
  );
}

function Overview({ stats, business, onRefresh }: { stats: Stats | null; business: Business; onRefresh: () => void }) {
  useEffect(() => { onRefresh(); }, [business]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!stats) return <p className="text-sm text-[var(--color-ink-mute)]">No data yet — is the database provisioned?</p>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <StatCard label="VIP members" value={stats.members.total} sub={`+${stats.members.new_7d} this week`} />
        <StatCard label="Text list" value={stats.members.sms_ok} sub="opted in to SMS" />
        <StatCard label="Email list" value={stats.members.email_ok} sub="opted in to email" />
        <StatCard label="Messages sent" value={stats.sends.sent} sub={stats.sends.failed ? `${stats.sends.failed} failed` : "all delivered to provider"} />
      </div>
      <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)]">
        <h3 className="text-lg">Channel status</h3>
        <div className="mt-3 space-y-2 text-sm">
          <ChannelRow ok={stats.channels.sms} label="Text messages (Twilio)" />
          <ChannelRow ok={stats.channels.email} label="Email (Resend)" />
        </div>
      </div>
    </div>
  );
}

function ChannelRow({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${ok ? "bg-[var(--color-italy-green)]" : "bg-[var(--color-gold)]"}`} />
      <span>{label}</span>
      <span className="text-xs text-[var(--color-ink-mute)]">{ok ? "ready" : "not configured yet"}</span>
    </div>
  );
}

function Members({ business }: { business: Business }) {
  const [members, setMembers] = useState<Member[]>([]);
  const [q, setQ] = useState("");
  const [consent, setConsent] = useState<"" | "sms" | "email">("");
  const [error, setError] = useState("");

  useEffect(() => {
    const t = setTimeout(async () => {
      try {
        const data = await api<{ members: Member[] }>(
          `/api/admin/members?business=${business}&q=${encodeURIComponent(q)}&consent=${consent}`,
        );
        setMembers(data.members);
        setError("");
      } catch {
        setError("Couldn't load members — check that the database is set up.");
      }
    }, 250);
    return () => clearTimeout(t);
  }, [business, q, consent]);

  function exportCsv() {
    // Neutralize CSV/formula injection: a member name/email starting with = + - @
    // (or a control char) could execute as a formula when the owner opens the file
    // in Excel/Sheets. Prefix such values with a single quote, then quote-escape.
    const cell = (v: unknown) => {
      let s = String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return `"${s.replace(/"/g, '""')}"`;
    };
    const head = "name,phone,email,sms_consent,email_consent,joined";
    const rows = members.map((m) =>
      [m.name, m.phone ?? "", m.email ?? "", m.sms_consent, m.email_consent, m.created_at].map(cell).join(","),
    );
    const blob = new Blob([[head, ...rows].join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `vip-members-${business}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search name / phone / email"
          className="min-w-52 flex-1 rounded-xl border border-[var(--color-cream-darker)] bg-white px-4 py-2.5 text-sm"
        />
        <select
          value={consent}
          onChange={(e) => setConsent(e.target.value as typeof consent)}
          className="rounded-xl border border-[var(--color-cream-darker)] bg-white px-3 py-2.5 text-sm"
        >
          <option value="">All members</option>
          <option value="sms">Text list only</option>
          <option value="email">Email list only</option>
        </select>
        <button
          onClick={exportCsv}
          disabled={!members.length}
          className="rounded-xl bg-[var(--color-ink)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
        >
          Export CSV
        </button>
      </div>
      {error && <p className="text-sm text-[var(--color-brand-red-bright)]">{error}</p>}
      <div className="overflow-x-auto rounded-2xl bg-white shadow-[var(--shadow-sm)]">
        <table className="w-full min-w-[560px] text-left text-sm">
          <thead>
            <tr className="border-b border-[var(--color-cream-darker)] text-xs uppercase tracking-wider text-[var(--color-ink-mute)]">
              <th className="px-4 py-3">Name</th>
              <th className="px-4 py-3">Phone</th>
              <th className="px-4 py-3">Email</th>
              <th className="px-4 py-3">Lists</th>
              <th className="px-4 py-3">Joined</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-b border-[var(--color-cream)] last:border-0">
                <td className="px-4 py-3 font-semibold">{m.name}</td>
                <td className="px-4 py-3">{m.phone ?? "—"}</td>
                <td className="px-4 py-3">{m.email ?? "—"}</td>
                <td className="px-4 py-3">
                  {m.sms_consent && <Badge>text</Badge>}{" "}
                  {m.email_consent && <Badge>email</Badge>}
                </td>
                <td className="px-4 py-3 text-[var(--color-ink-mute)]">
                  {new Date(m.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
            {!members.length && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-[var(--color-ink-mute)]">
                  No members yet — signups from the website's VIP form land here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Badge({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-block rounded-full bg-[var(--color-cream)] px-2 py-0.5 text-xs font-bold text-[var(--color-ink-soft)]">
      {children}
    </span>
  );
}

function Blast({ business, stats, onSent }: { business: Business; stats: Stats | null; onSent: () => void }) {
  const [message, setMessage] = useState("");
  const [subject, setSubject] = useState("");
  const [smsOn, setSmsOn] = useState(true);
  const [emailOn, setEmailOn] = useState(true);
  const [promoCode, setPromoCode] = useState("");
  const [promoDescription, setPromoDescription] = useState("");
  const [phase, setPhase] = useState<"compose" | "confirm" | "sending" | "done">("compose");
  const [preview, setPreview] = useState<{ smsCount: number; emailCount: number; smsPreview: string | null; channelsReady: { sms: boolean; email: boolean } } | null>(null);
  const [result, setResult] = useState<{ smsSent: number; smsFailed: number; emailSent: number; emailFailed: number } | null>(null);
  const [error, setError] = useState("");

  const body = {
    business,
    message: message.trim(),
    subject: subject.trim(),
    channels: { sms: smsOn, email: emailOn },
    promoCode: promoCode.trim() || undefined,
    promoDescription: promoDescription.trim() || undefined,
  };

  async function doDryRun(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      const data = await api<typeof preview & { dryRun: true }>("/api/admin/broadcast", {
        method: "POST",
        body: JSON.stringify({ ...body, dryRun: true }),
      });
      setPreview(data);
      setPhase("confirm");
    } catch (err) {
      setError(err instanceof ApiError ? `Couldn't preview: ${err.message}` : "Couldn't preview.");
    }
  }

  async function doSend() {
    setPhase("sending");
    setError("");
    try {
      const data = await api<NonNullable<typeof result>>("/api/admin/broadcast", {
        method: "POST",
        body: JSON.stringify(body),
      });
      setResult(data);
      setPhase("done");
      onSent();
    } catch (err) {
      setPhase("confirm");
      setError(
        err instanceof ApiError && err.message.endsWith("not_configured")
          ? "A selected channel isn't configured on the server yet — see Overview."
          : "Send failed — nothing may have gone out. Check History before retrying.",
      );
    }
  }

  if (phase === "done" && result) {
    return (
      <div className="rounded-2xl bg-white p-6 shadow-[var(--shadow-md)]">
        <h3 className="text-2xl">Blast sent</h3>
        <p className="mt-2 text-sm text-[var(--color-ink-soft)]">
          Texts: {result.smsSent} sent{result.smsFailed ? `, ${result.smsFailed} failed` : ""}. Emails:{" "}
          {result.emailSent} sent{result.emailFailed ? `, ${result.emailFailed} failed` : ""}.
        </p>
        <button
          onClick={() => { setPhase("compose"); setMessage(""); setSubject(""); setPromoCode(""); setPromoDescription(""); setResult(null); }}
          className="mt-4 rounded-full bg-[var(--color-brand-red)] px-5 py-2.5 text-sm font-bold text-white"
        >
          New blast
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={doDryRun} className="space-y-4">
      <div className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)]">
        <div className="flex flex-wrap gap-4 text-sm font-semibold">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={smsOn} onChange={(e) => setSmsOn(e.target.checked)} />
            Text ({stats?.members.sms_ok ?? "…"} on list)
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={emailOn} onChange={(e) => setEmailOn(e.target.checked)} />
            Email ({stats?.members.email_ok ?? "…"} on list)
          </label>
        </div>
        {emailOn && (
          <input
            value={subject}
            onChange={(e) => setSubject(e.target.value)}
            placeholder="Email subject — e.g. This weekend only: 2 large pies $30"
            className="mt-4 w-full rounded-xl border border-[var(--color-cream-darker)] px-4 py-2.5 text-sm"
          />
        )}
        <textarea
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          rows={4}
          placeholder={"The offer, in plain words. Example:\nGame day special — 2 large cheese pies + 12 garlic knots for $30, Sat & Sun only. Show this text at the counter or order at gigislongbranch.com."}
          className="mt-3 w-full rounded-xl border border-[var(--color-cream-darker)] px-4 py-3 text-sm"
        />
        {smsOn && (
          <p className="mt-1 text-xs text-[var(--color-ink-mute)]">
            {message.length} chars — texts over 160 characters send as multiple segments. "Txt STOP to opt out" is added automatically.
          </p>
        )}
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <input
            value={promoCode}
            onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
            placeholder="Promo code (optional) — e.g. GAMEDAY30"
            className="rounded-xl border border-[var(--color-cream-darker)] px-4 py-2.5 text-sm"
          />
          <input
            value={promoDescription}
            onChange={(e) => setPromoDescription(e.target.value)}
            placeholder="What the code gets them"
            className="rounded-xl border border-[var(--color-cream-darker)] px-4 py-2.5 text-sm"
          />
        </div>
      </div>

      {error && <p className="text-sm font-semibold text-[var(--color-brand-red-bright)]">{error}</p>}

      {phase === "compose" && (
        <button
          disabled={!message.trim() || (!smsOn && !emailOn) || (emailOn && !subject.trim())}
          className="rounded-full bg-[var(--color-brand-red)] px-6 py-3 text-sm font-bold text-white disabled:opacity-40"
        >
          Preview blast
        </button>
      )}

      {(phase === "confirm" || phase === "sending") && preview && (
        <div className="rounded-2xl border-2 border-[var(--color-gold)] bg-white p-5 shadow-[var(--shadow-md)]">
          <h3 className="text-lg">Confirm</h3>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">
            This goes to <strong>{smsOn ? `${preview.smsCount} phones` : ""}{smsOn && emailOn ? " and " : ""}
            {emailOn ? `${preview.emailCount} inboxes` : ""}</strong> right now.
          </p>
          {preview.smsPreview && (
            <div className="mt-3 rounded-xl bg-[var(--color-cream)] p-3 text-sm">
              <div className="text-xs font-bold uppercase text-[var(--color-ink-mute)]">Text preview</div>
              <p className="mt-1">{preview.smsPreview}</p>
            </div>
          )}
          {((smsOn && !preview.channelsReady.sms) || (emailOn && !preview.channelsReady.email)) && (
            <p className="mt-3 text-sm font-semibold text-[var(--color-brand-red-bright)]">
              Heads up: a selected channel isn't configured on the server yet — those sends will fail.
            </p>
          )}
          <div className="mt-4 flex gap-3">
            <button
              type="button"
              onClick={doSend}
              disabled={phase === "sending"}
              className="rounded-full bg-[var(--color-brand-red)] px-6 py-3 text-sm font-bold text-white disabled:opacity-60"
            >
              {phase === "sending" ? "Sending…" : "Send it"}
            </button>
            <button
              type="button"
              onClick={() => setPhase("compose")}
              disabled={phase === "sending"}
              className="rounded-full border border-[var(--color-cream-darker)] px-6 py-3 text-sm font-bold"
            >
              Back
            </button>
          </div>
        </div>
      )}
    </form>
  );
}

function History({ business }: { business: Business }) {
  const [rows, setRows] = useState<BroadcastRow[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api<{ broadcasts: BroadcastRow[] }>(`/api/admin/sends?business=${business}`)
      .then((d) => setRows(d.broadcasts))
      .catch(() => setError("Couldn't load history."));
  }, [business]);

  if (error) return <p className="text-sm text-[var(--color-brand-red-bright)]">{error}</p>;
  return (
    <div className="space-y-3">
      {rows.map((b) => (
        <div key={b.id} className="rounded-2xl bg-white p-5 shadow-[var(--shadow-sm)]">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div className="font-bold">{b.subject ?? "Text blast"}</div>
            <div className="text-xs text-[var(--color-ink-mute)]">
              {new Date(b.created_at).toLocaleString()}
            </div>
          </div>
          <p className="mt-1 text-sm text-[var(--color-ink-soft)]">{b.message}</p>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            <Badge>{b.channels}</Badge>
            {b.promo_code && <Badge>code {b.promo_code}</Badge>}
            <Badge>{b.sent} sent</Badge>
            {b.failed > 0 && <Badge>{b.failed} failed</Badge>}
          </div>
        </div>
      ))}
      {!rows.length && (
        <p className="rounded-2xl bg-white p-8 text-center text-sm text-[var(--color-ink-mute)] shadow-[var(--shadow-sm)]">
          No blasts yet — your first one will show up here.
        </p>
      )}
    </div>
  );
}
