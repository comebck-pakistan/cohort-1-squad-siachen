// ---------------------------------------------------------------------------
// scripts/build-og-image.mjs
//
// Generates /public/og-image.png — the 1200x630 social-share card used
// for Open Graph and Twitter card previews.
//
//   $ node frontend/scripts/build-og-image.mjs
//
// Renders an SVG to PNG using `sharp` (added as an optional devDep
// when this script was written). Re-run any time you want to update
// the marketing copy or layout — overwrites the file in place.
//
// For the public launch the team should swap this placeholder for a
// designer-authored PNG. Drop it at /public/og-image.png at 1200x630
// and this script becomes a no-op.
// ---------------------------------------------------------------------------

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "public", "og-image.png");

// If a designer has already dropped a real PNG in /public/, leave it
// alone. The script's job is only to seed the placeholder.
if (existsSync(OUT)) {
  console.log(
    `[build-og-image] ${OUT} already exists — skipping. Delete it to regenerate.`,
  );
  process.exit(0);
}

// ---- SVG composition (Option A from the PR brief) --------------------------
// Teal gradient background + Recepta wordmark + tagline + small
// phone-mockup rect. The colors are pulled from styles.css
// (`bg-gradient-luxe` uses #2A6F6A → #0F3D3A). If the design tokens
// change, update them here too.
const W = 1200;
const H = 630;

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <linearGradient id="bg" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="#2A6F6A"/>
      <stop offset="100%" stop-color="#0F3D3A"/>
    </linearGradient>
    <linearGradient id="phone" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stop-color="#FFFFFF"/>
      <stop offset="100%" stop-color="#F4F6F4"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Subtle dot grid (decoration) -->
  <g fill="#FFFFFF" fill-opacity="0.05">
    ${Array.from({ length: 12 })
      .map(
        (_, row) =>
          Array.from({ length: 24 })
            .map(
              (_, col) =>
                `<circle cx="${50 + col * 50}" cy="${50 + row * 50}" r="2"/>`,
            )
            .join(""),
      )
      .join("")}
  </g>

  <!-- Wordmark (logo + name) -->
  <g transform="translate(80, 120)">
    <rect x="0" y="0" width="72" height="72" rx="20" fill="#FFFFFF" fill-opacity="0.12"/>
    <text x="96" y="50" font-family="Inter, system-ui, sans-serif" font-size="56" font-weight="700" fill="#FFFFFF" letter-spacing="-1.5">
      Recepta
    </text>
  </g>

  <!-- Headline -->
  <text x="80" y="290" font-family="Fraunces, Georgia, serif" font-size="72" font-weight="600" fill="#FFFFFF" letter-spacing="-2">
    The AI receptionist
  </text>
  <text x="80" y="370" font-family="Fraunces, Georgia, serif" font-size="72" font-weight="600" fill="#FFFFFF" letter-spacing="-2">
    for Pakistani salons
  </text>

  <!-- Subhead -->
  <text x="80" y="430" font-family="Inter, system-ui, sans-serif" font-size="26" font-weight="400" fill="#FFFFFF" fill-opacity="0.85">
    Books appointments on WhatsApp · Urdu &amp; English · 24/7
  </text>

  <!-- CTA pill -->
  <g transform="translate(80, 480)">
    <rect x="0" y="0" width="260" height="64" rx="32" fill="#FFFFFF"/>
    <text x="130" y="42" font-family="Inter, system-ui, sans-serif" font-size="22" font-weight="600" fill="#0F3D3A" text-anchor="middle">
      Start free trial
    </text>
  </g>

  <!-- Phone mockup (right side) -->
  <g transform="translate(820, 90)">
    <rect x="0" y="0" width="300" height="450" rx="36" fill="url(#phone)"/>
    <rect x="20" y="40" width="260" height="370" rx="20" fill="#F4F6F4"/>

    <!-- WhatsApp-style header bar -->
    <rect x="20" y="40" width="260" height="50" rx="20" fill="#0F3D3A"/>
    <text x="42" y="72" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="600" fill="#FFFFFF">Sana's Nail Bar</text>

    <!-- Customer message bubble -->
    <rect x="40" y="110" width="200" height="40" rx="14" fill="#FFFFFF"/>
    <text x="56" y="135" font-family="Inter, system-ui, sans-serif" font-size="14" fill="#0F3D3A">Hi! Acrylic nails?</text>

    <!-- AI reply bubble -->
    <rect x="60" y="170" width="220" height="80" rx="14" fill="#2A6F6A"/>
    <text x="76" y="200" font-family="Inter, system-ui, sans-serif" font-size="14" fill="#FFFFFF">Yes! PKR 3,500. We have</text>
    <text x="76" y="220" font-family="Inter, system-ui, sans-serif" font-size="14" fill="#FFFFFF">slots tomorrow 3pm or</text>
    <text x="76" y="240" font-family="Inter, system-ui, sans-serif" font-size="14" fill="#FFFFFF">Thursday 11am — which?</text>

    <!-- Customer picks -->
    <rect x="40" y="270" width="200" height="40" rx="14" fill="#FFFFFF"/>
    <text x="56" y="295" font-family="Inter, system-ui, sans-serif" font-size="14" fill="#0F3D3A">Tomorrow 3pm please</text>

    <!-- Confirmation bubble -->
    <rect x="60" y="330" width="220" height="60" rx="14" fill="#2A6F6A"/>
    <text x="76" y="355" font-family="Inter, system-ui, sans-serif" font-size="14" font-weight="600" fill="#FFFFFF">✓ Booked for tomorrow</text>
    <text x="76" y="375" font-family="Inter, system-ui, sans-serif" font-size="14" fill="#FFFFFF">3:00 PM. See you soon!</text>
  </g>

  <!-- Footer line -->
  <text x="80" y="585" font-family="Inter, system-ui, sans-serif" font-size="16" font-weight="400" fill="#FFFFFF" fill-opacity="0.65">
    receptaagent.tech
  </text>
</svg>
`.trim();

async function main() {
  let sharp;
  try {
    sharp = (await import("sharp")).default;
  } catch {
    console.error(
      "[build-og-image] sharp is not installed. Run `npm install --save-dev sharp` from the frontend dir, then re-run this script.",
    );
    process.exit(1);
  }
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  writeFileSync(OUT, png);
  const size = png.byteLength;
  console.log(
    `[build-og-image] wrote ${OUT} (${W}x${H}, ${(size / 1024).toFixed(1)} KB)`,
  );
  if (size > 200 * 1024) {
    console.warn(
      `[build-og-image] WARN: file is over 200 KB. Consider running it through a compressor before launch.`,
    );
  }
}

main().catch((err) => {
  console.error("[build-og-image] failed:", err);
  process.exit(1);
});
