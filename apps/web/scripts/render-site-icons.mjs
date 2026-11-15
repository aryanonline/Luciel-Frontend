/**
 * Renders the site icon's raster files from src/app/icon.svg, the Logo's V mark:
 *
 *   src/app/favicon.ico     16, 32 and 48 px PNG images in one ICO container (the path
 *                           browsers and crawlers ask for unprompted)
 *   src/app/apple-icon.png  180 px and full-bleed: iOS rounds the corners itself and paints
 *                           transparent pixels black, so the background rect loses its rx
 *
 * and records the sha256 of all three files in tests/unit/site-icon-renders.json.
 * tests/unit/site-icon.test.tsx compares that record with the files, so an icon.svg edited
 * without a re-render, or a raster replaced by hand, fails the unit tests.
 *
 * A browser draws the SVG on a canvas, so each image is what a browser shows for icon.svg.
 * By default that is the Chromium that Playwright pins
 * (`pnpm --filter @luciel/web exec playwright install chromium`). `--channel msedge` or
 * `--channel chrome` uses an installed Edge or Chrome instead, and E2E_CHROMIUM_EXECUTABLE
 * any other Chromium build, as for the e2e suite.
 *
 *   pnpm --filter @luciel/web exec node scripts/render-site-icons.mjs [--channel msedge]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { chromium } from '@playwright/test';

const APP = new URL('../src/app/', import.meta.url);
const RECORD = new URL('../tests/unit/site-icon-renders.json', import.meta.url);
const ICO_SIZES = [16, 32, 48];
const TOUCH_SIZE = 180;

/** The digests the unit test recomputes. Line endings never change what the SVG draws. */
const textDigest = (text) => createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const fileDigest = (bytes) => createHash('sha256').update(bytes).digest('hex');

const { values: options } = parseArgs({ options: { channel: { type: 'string' } } });

const svg = readFileSync(new URL('icon.svg', APP), 'utf8');
// The touch icon is the same drawing without the rounded corners of its background.
const ROUNDED_RECT = /(<rect\b[^>]*?)\s+rx="[^"]*"/;
if (!ROUNDED_RECT.test(svg)) {
  throw new Error(
    'icon.svg has no <rect rx="…"> background: decide how the full-bleed touch icon is drawn, then update this script',
  );
}
const fullBleed = svg.replace(ROUNDED_RECT, '$1');

const browser = await chromium.launch({
  headless: true,
  ...(options.channel ? { channel: options.channel } : {}),
  ...(process.env.E2E_CHROMIUM_EXECUTABLE
    ? { executablePath: process.env.E2E_CHROMIUM_EXECUTABLE }
    : {}),
});
const renderer = `${options.channel ?? 'chromium'} ${browser.version()}`;
const page = await browser.newPage();
await page.setContent('<!doctype html><html><body></body></html>');

/** One PNG of `source` at `size` px square, drawn by the browser. */
async function draw(source, size) {
  const base64 = await page.evaluate(
    async ([text, px]) => {
      const image = new Image();
      image.width = px;
      image.height = px;
      image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(text)}`;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = px;
      canvas.height = px;
      canvas.getContext('2d').drawImage(image, 0, 0, px, px);
      return canvas.toDataURL('image/png').split(',')[1];
    },
    [source, size],
  );
  return Buffer.from(base64, 'base64');
}

const pngs = [];
for (const size of ICO_SIZES) pngs.push(await draw(svg, size));
const touch = await draw(fullBleed, TOUCH_SIZE);
await browser.close();

// ICO: ICONDIR (6 bytes), one ICONDIRENTRY (16 bytes) per image, then the images. Each
// image is a PNG, which every current browser and Windows since Vista read.
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type 1: icon
header.writeUInt16LE(ICO_SIZES.length, 4);
let offset = header.length + 16 * ICO_SIZES.length;
const entries = ICO_SIZES.map((size, i) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size, 0); // width (every size here is under 256)
  entry.writeUInt8(size, 1); // height
  entry.writeUInt8(0, 2); // palette colours: none
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(pngs[i].length, 8); // image size
  entry.writeUInt32LE(offset, 12); // image offset
  offset += pngs[i].length;
  return entry;
});
const ico = Buffer.concat([header, ...entries, ...pngs]);

writeFileSync(new URL('favicon.ico', APP), ico);
writeFileSync(new URL('apple-icon.png', APP), touch);
const record = {
  note: 'Written by scripts/render-site-icons.mjs, which renders favicon.ico and apple-icon.png from icon.svg (src/app). tests/unit/site-icon.test.tsx compares these digests with the files.',
  renderer,
  sha256: {
    'icon.svg': textDigest(svg),
    'favicon.ico': fileDigest(ico),
    'apple-icon.png': fileDigest(touch),
  },
};
writeFileSync(RECORD, `${JSON.stringify(record, null, 2)}\n`);

console.log(
  `favicon.ico ${ico.length} bytes (${ICO_SIZES.map((s, i) => `${s} px ${pngs[i].length} B`).join(', ')}), ` +
    `apple-icon.png ${touch.length} bytes, rendered by ${renderer}; digests in tests/unit/site-icon-renders.json`,
);
