/**
 * Rasterizes public/icons/logo.svg into PNG sizes required by Chrome.
 */
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const svgPath = join(root, "public", "icons", "logo.svg");
const outDir = join(root, "public", "icons");

if (!existsSync(svgPath)) {
  console.error("Missing logo.svg at", svgPath);
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
const svg = readFileSync(svgPath);

for (const size of [16, 32, 48, 128]) {
  const out = join(outDir, `icon-${size}.png`);
  await sharp(svg).resize(size, size, { fit: "contain" }).png({ compressionLevel: 9 }).toFile(out);
  console.log("Wrote", out);
}
