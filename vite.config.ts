import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Pages preview lives at jorgeramirez76.github.io/gigis-long-branch-demo/
// so all asset URLs need the matching base path. When you point a custom
// domain at the repo, switch to "/" and remove the .nojekyll-touch step.
const REPO_BASE = "/gigis-long-branch-demo/";

export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? REPO_BASE : "/",
  plugins: [react(), tailwindcss()],
  // vite-react-ssg always injects an inline __VITE_REACT_SSG_HASH__ assignment,
  // even for this single-page build, which has no route loaders and never reads
  // the value. Remove its placeholder before the package replaces it so the
  // strict CSP can stay intact without logging a blocked-script error.
  ssgOptions: {
    onPageRendered(_route, html) {
      return html.replace(/\s*<script>\/\* SCRIPT_COMMENT_PLACEHOLDER \*\/<\/script>/, "");
    },
  },
  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: false,
    minify: "esbuild",
    rollupOptions: {
      input: {
        main: new URL("./index.html", import.meta.url).pathname,
        admin: new URL("./admin.html", import.meta.url).pathname,
      },
    },
  },
});
