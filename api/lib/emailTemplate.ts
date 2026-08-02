/**
 * Branded HTML email for VIP blasts. Inline styles only (email clients strip
 * stylesheets). Physical address + unsubscribe link in the footer per CAN-SPAM.
 */

const ADDRESS = "Gigi's NY Style Pizza · 140 Brighton Ave, Long Branch, NJ 07740 · (732) 377-2468";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function emailHtml(opts: {
  bodyText: string;
  unsubUrl: string;
  promoCode?: string;
  promoDescription?: string;
  /** Button under the message. Defaults to the menu — set both to point it elsewhere. */
  ctaText?: string;
  ctaUrl?: string;
}): string {
  const paragraphs = opts.bodyText
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:#1a1210;">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  const promoBlock = opts.promoCode
    ? `<div style="margin:24px 0;padding:20px;background:#faf2e1;border:2px dashed #c89441;border-radius:12px;text-align:center;">
        <div style="font-size:13px;text-transform:uppercase;letter-spacing:1px;color:#6a5a52;margin-bottom:6px;">Your code</div>
        <div style="font-size:28px;font-weight:800;letter-spacing:2px;color:#9b121a;">${escapeHtml(opts.promoCode)}</div>
        ${opts.promoDescription ? `<div style="font-size:14px;color:#3c2f2a;margin-top:6px;">${escapeHtml(opts.promoDescription)}</div>` : ""}
      </div>`
    : "";

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f0e5c8;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#9b121a;border-radius:16px 16px 0 0;padding:28px 24px;text-align:center;">
      <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">GIGI'S VIP CLUB</div>
      <div style="font-size:13px;color:#e6b45e;margin-top:4px;letter-spacing:1px;text-transform:uppercase;">NY Style Pizza — Long Branch</div>
    </div>
    <div style="background:#ffffff;padding:28px 24px;">
      ${paragraphs}
      ${promoBlock}
      <div style="text-align:center;margin-top:24px;">
        <a href="${escapeHtml(opts.ctaUrl || "https://gigislongbranch.com/#menu")}" style="display:inline-block;background:#e6b45e;color:#1a1210;font-weight:700;text-decoration:none;padding:13px 32px;border-radius:999px;font-size:15px;">${escapeHtml(opts.ctaText || "See the menu")}</a>
      </div>
    </div>
    <div style="background:#2b1a14;border-radius:0 0 16px 16px;padding:18px 24px;text-align:center;">
      <div style="font-size:12px;color:#c9b8a8;line-height:1.6;">${ADDRESS}</div>
      <div style="font-size:12px;margin-top:8px;">
        <a href="${opts.unsubUrl}" style="color:#e6b45e;">Unsubscribe</a>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Branded order-confirmation (receipt) email. Transactional — no unsubscribe
 * required, but always carries the store's physical address + phone. */
export function receiptHtml(opts: {
  customerName: string;
  fulfillment: "pickup" | "delivery";
  orderRef?: string;
  address?: string;
  lines: { quantity: number; name: string; options?: string; lineTotal: string }[];
  subtotal: string;
  tax: string;
  tip?: string;
  total: string;
  paymentLine: string;
  /** e.g. "Your order will be ready for pickup in about 15 minutes." */
  readyLine?: string;
  /** Invite the customer to the free-pie VIP club (non-members only). */
  vipPitch?: boolean;
  /** Where the invite's button goes. Callers pass the /vip-club/ page with the
   * order's details in the query string so the customer doesn't retype what
   * they just gave us; falls back to the homepage form's anchor. */
  vipJoinUrl?: string;
}): string {
  const rows = opts.lines
    .map(
      (l) => `<tr>
        <td style="padding:6px 0;font-size:14px;color:#1a1210;">${l.quantity}× ${escapeHtml(l.name)}${l.options ? `<br><span style="font-size:12px;color:#6a5a52;">${escapeHtml(l.options)}</span>` : ""}</td>
        <td style="padding:6px 0;font-size:14px;color:#1a1210;text-align:right;vertical-align:top;">${l.lineTotal}</td>
      </tr>`,
    )
    .join("");
  const totalRow = (label: string, val: string, bold = false) =>
    `<tr><td style="padding:3px 0;font-size:${bold ? 16 : 13}px;${bold ? "font-weight:800;" : ""}color:${bold ? "#1a1210" : "#6a5a52"};">${label}</td><td style="padding:3px 0;font-size:${bold ? 16 : 13}px;${bold ? "font-weight:800;" : ""}color:${bold ? "#1a1210" : "#6a5a52"};text-align:right;">${val}</td></tr>`;

  return `<!doctype html>
<html>
<body style="margin:0;padding:0;background:#f0e5c8;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#9b121a;border-radius:16px 16px 0 0;padding:28px 24px;text-align:center;">
      <div style="font-size:26px;font-weight:800;color:#ffffff;letter-spacing:0.5px;">ORDER RECEIVED</div>
      <div style="font-size:13px;color:#e6b45e;margin-top:4px;letter-spacing:1px;text-transform:uppercase;">Gigi's NY Style Pizza — Long Branch</div>
    </div>
    <div style="background:#ffffff;padding:28px 24px;">
      <p style="margin:0 0 14px;font-size:16px;line-height:1.6;color:#1a1210;">Thanks, ${escapeHtml(opts.customerName)}! Your ${opts.fulfillment} order is in — we're firing it up now.</p>
      ${opts.orderRef ? `<p style="margin:0 0 6px;font-size:13px;color:#6a5a52;">Order&nbsp;#&nbsp;<span style="font-family:monospace;">${escapeHtml(opts.orderRef)}</span></p>` : ""}
      ${opts.fulfillment === "delivery" && opts.address ? `<p style="margin:0 0 14px;font-size:13px;color:#6a5a52;">Delivering to: ${escapeHtml(opts.address)}</p>` : ""}
      ${opts.readyLine ? `<div style="margin:14px 0;padding:14px 16px;background:#faf2e1;border:2px solid #c89441;border-radius:12px;text-align:center;font-size:16px;font-weight:700;color:#1a1210;">&#9201; ${escapeHtml(opts.readyLine)}</div>` : ""}
      <table style="width:100%;border-collapse:collapse;border-top:1px solid #eee2cd;border-bottom:1px solid #eee2cd;margin:12px 0;">${rows}</table>
      <table style="width:100%;border-collapse:collapse;">
        ${totalRow("Subtotal", opts.subtotal)}
        ${totalRow("NJ tax (6.625%)", opts.tax)}
        ${opts.tip ? totalRow("Tip", opts.tip) : ""}
        ${totalRow("Total", opts.total, true)}
      </table>
      <div style="margin-top:16px;padding:14px 16px;background:#faf2e1;border-radius:12px;font-size:14px;color:#1a1210;">${escapeHtml(opts.paymentLine)}</div>
      ${opts.vipPitch ? `<div style="margin:20px 0 0;padding:18px;background:#9b121a;border-radius:12px;text-align:center;">
        <div style="font-size:20px;font-weight:800;color:#ffffff;">&#127829; Get a FREE plain pie</div>
        <div style="font-size:14px;color:#f3d9be;margin-top:6px;line-height:1.5;">Join Gigi's VIP Club and we'll send you a code for a free cheese pie &mdash; plus first dibs on weekly deals. New members only.</div>
        <a href="${escapeHtml(opts.vipJoinUrl || "https://gigislongbranch.com/#vip-club")}" style="display:inline-block;margin-top:12px;background:#e6b45e;color:#1a1210;font-weight:800;text-decoration:none;padding:11px 26px;border-radius:999px;font-size:14px;">Join &amp; claim my free pie</a>
      </div>` : ""}
      <p style="margin:18px 0 0;font-size:13px;color:#6a5a52;">Questions about your order? Call us at (732) 377-2468.</p>
    </div>
    <div style="background:#2b1a14;border-radius:0 0 16px 16px;padding:18px 24px;text-align:center;">
      <div style="font-size:12px;color:#c9b8a8;line-height:1.6;">${ADDRESS}</div>
    </div>
  </div>
</body>
</html>`;
}
