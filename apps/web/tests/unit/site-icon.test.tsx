import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import { color } from '@luciel/design-tokens';
import { Logo } from '@luciel/ui';

/**
 * The site icon (2026-11-14). The app shipped none: no icon in src/app, no public/ folder,
 * so the browser fetched /favicon.ico by itself on the first page it opened and logged a
 * 404 (a production build showed it on "/"). The icon is the Logo's V mark, served by
 * Next's metadata file conventions from the ROOT app segment: favicon.ico at /favicon.ico
 * (the path browsers and crawlers ask for unprompted; middleware.ts already skips it),
 * icon.svg and apple-icon.png through the <link> tags Next adds to every page's head. A
 * favicon.ico inside a route group or a nested folder is not served at /favicon.ico.
 * The two raster files are renders of icon.svg; apple-icon.png is full-bleed (iOS
 * rounds the corners itself and paints transparent pixels black).
 */
const WEB = join(__dirname, '..', '..');
const APP = join(WEB, 'src', 'app');
const PUBLIC = join(WEB, 'public');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR chunk (it always comes first). */
function pngSize(png: Buffer): [number, number] {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

describe('the site icon', () => {
  it('favicon.ico is a real icon in the root app segment, with 16, 32 and 48 px images', () => {
    const ico = readFileSync(join(APP, 'favicon.ico'));
    // ICONDIR: reserved 0, type 1 (icon), then the image count.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    const images = Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
      const entry = 6 + 16 * i;
      const length = ico.readUInt32LE(entry + 8);
      const offset = ico.readUInt32LE(entry + 12);
      expect(offset + length).toBeLessThanOrEqual(ico.length);
      return { size: ico.readUInt8(entry) || 256, data: ico.subarray(offset, offset + length) };
    });
    expect(images.map((image) => image.size)).toEqual([16, 32, 48]);
    for (const { size, data } of images) expect(pngSize(data)).toEqual([size, size]);
  });

  it("icon.svg is the Logo's V mark on the brand accent", () => {
    const svg = readFileSync(join(APP, 'icon.svg'), 'utf8');
    const { container } = render(<Logo />);
    const mark = container.querySelector('svg');
    const path = mark?.querySelector('path');
    expect(path).toBeTruthy();
    expect(svg).toContain(`viewBox="${mark?.getAttribute('viewBox')}"`);
    expect(svg).toContain(`d="${path?.getAttribute('d')}"`);
    expect(svg).toContain(`stroke-width="${path?.getAttribute('stroke-width')}"`);
    expect(svg).toContain(`fill="${color.accent}"`);
  });

  it('apple-icon.png is the 180 px touch icon', () => {
    expect(pngSize(readFileSync(join(APP, 'apple-icon.png')))).toEqual([180, 180]);
  });
});

/**
 * A root-relative file a page names must exist where Next serves it from: public/, or
 * a metadata file at the top of src/app. Paths under /_next/ are the build's own.
 */
const STATIC_REF =
  /["'`(](\/(?!\/|_next\/)[\w\-./]*\.(?:ico|png|svg|jpe?g|gif|webp|avif|webmanifest|json|txt|xml|woff2?|ttf|otf|pdf|mp4|webm))(?:\?[^"'`)\s]*)?["'`)]/gi;
const APP_METADATA_FILE =
  /^(favicon\.ico|(icon|apple-icon)\d*\.(ico|jpe?g|png|svg)|(opengraph|twitter)-image\d*\.(jpe?g|png|gif)|robots\.txt|sitemap\.xml|manifest\.(json|webmanifest))$/;

function staticRefs(text: string): string[] {
  return [...text.matchAll(STATIC_REF)].flatMap((m) => (m[1] ? [m[1]] : []));
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx|css)$/.test(name) ? [full] : [];
  });
}

function isServed(ref: string): boolean {
  if (existsSync(join(PUBLIC, ref))) return true;
  const name = posix.basename(ref);
  return posix.dirname(ref) === '/' && APP_METADATA_FILE.test(name) && existsSync(join(APP, name));
}

describe('static files the app references', () => {
  it('every root-relative file named in src exists where Next serves it', () => {
    // The scan itself: what a page would write, and what it must leave alone.
    expect(staticRefs(`<img src="/brand/hero.png" /> icons: { icon: '/favicon.ico?v=2' }`)).toEqual(
      ['/brand/hero.png', '/favicon.ico'],
    );
    expect(staticRefs(`'//cdn.example/a.png' "/_next/static/media/a.woff2" '/dashboard'`)).toEqual(
      [],
    );
    expect(isServed('/favicon.ico')).toBe(true);
    expect(isServed('/fonts/inter-latin-wght-normal.woff2')).toBe(false);

    const missing = sourceFiles(join(WEB, 'src')).flatMap((file) =>
      staticRefs(readFileSync(file, 'utf8'))
        .filter((ref) => !isServed(ref))
        .map((ref) => `${ref} (${relative(WEB, file).split(sep).join('/')})`),
    );
    expect(missing).toEqual([]);
  });
});
