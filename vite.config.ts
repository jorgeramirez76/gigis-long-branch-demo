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
  build: {
    target: "es2020",
    cssCodeSplit: true,
    sourcemap: false,
    minify: "esbuild",
  },
});
