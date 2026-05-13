/**
 * Second pass: bundle the content script as a single classic IIFE.
 * Manifest-declared content scripts cannot use bare ES `import`; the main Vite
 * build outputs ES modules for the popup/service worker only.
 */
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  publicDir: false,
  build: {
    emptyOutDir: false,
    outDir: "dist",
    lib: {
      entry: resolve(rootDir, "src/content/content-script.ts"),
      name: "SfvContentScript",
      formats: ["iife"],
      fileName: () => "content-script",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: "content-script.js",
      },
    },
  },
});
