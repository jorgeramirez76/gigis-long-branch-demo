import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

// 2026-09-09, per Jorge: a verified VIP signup TEXTS the store (Tommy) instead of emailing the
// owner. The email survives only as a flagged fallback for when the text cannot be sent.
const notifier = readFileSync(new URL("../api/lib/vipStaffNotify.ts", import.meta.url), "utf8");

test("the text to the store is the channel, on its own dedicated number", () => {
  assert.match(notifier, /process\.env\.VIP_SIGNUP_ALERT_PHONE \|\| process\.env\.STAFF_ALERT_PHONE/);
  assert.match(notifier, /await sendSms\(alertPhone, body\)/);
  // a sent text ends the notification — no email rides along
  assert.match(notifier, /if \(r\.sent\) return;/);
  // the register gets who, how to reach them, and the code to redeem
  assert.match(notifier, /new member \$\{p\.name\}, \$\{displayPhone\(p\.phone\)\}, \$\{p\.email\}/);
  assert.match(notifier, /Free-pie code \$\{code\}/);
  // the old masked SMS-only heads-up path is gone
  assert.doesNotMatch(notifier, /sendWelcomeSms/);
});

test("email is a flagged fallback, only after the text path has been tried", () => {
  const textIdx = notifier.indexOf("await sendSms(alertPhone, body)");
  const emailIdx = notifier.indexOf("await sendReceiptEmail(");
  assert.ok(textIdx > 0 && emailIdx > textIdx, "email must come after the text attempt");
  assert.match(notifier, /\(text not sent\)/);
  assert.match(notifier, /sent by email because \$\{why\}/);
});

test("a notification problem can never fail the signup", () => {
  assert.match(notifier, /console\.error\("\[vip\] staff notification failed \(non-fatal\)", err\)/);
});

test("ops can see whether the store number is set", () => {
  const stats = readFileSync(new URL("../api/admin/stats.ts", import.meta.url), "utf8");
  assert.match(stats, /vipSignupAlertPhone: !!process\.env\.VIP_SIGNUP_ALERT_PHONE/);
});
