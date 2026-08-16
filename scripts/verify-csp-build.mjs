import fs from "node:fs";
import path from "node:path";

const file = path.resolve("dist/index.html");
const html = fs.readFileSync(file, "utf8");

// JSON-LD is inert metadata. Every executable script must be external so the
// production `script-src` policy can remain strict without hashes that change
// on every SSG build.
const executableInline = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(
  ([, attrs, body]) => !/\bsrc\s*=/.test(attrs) && !/type=["']application\/ld\+json["']/.test(attrs) && body.trim(),
);

if (executableInline.length) {
  console.error(`verify-csp-build: found ${executableInline.length} executable inline script(s)`);
  process.exit(1);
}

if (!/<script\b[^>]*type=["']module["'][^>]*src=/.test(html)) {
  console.error("verify-csp-build: main module script is missing");
  process.exit(1);
}

console.log("verify-csp-build: OK — no executable inline scripts");
