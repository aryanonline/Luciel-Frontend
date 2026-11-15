import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';
import ts from 'typescript';
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
 * favicon.ico and apple-icon.png are renders of icon.svg by scripts/render-site-icons.mjs,
 * which records the three files' sha256 in site-icon-renders.json; apple-icon.png is
 * full-bleed (iOS rounds the corners itself and paints transparent pixels black).
 * tests/e2e/site-icon.spec.ts checks what the server answers for them.
 */
const WEB = join(__dirname, '..', '..');
const REPO = join(WEB, '..', '..');
const APP = join(WEB, 'src', 'app');
const PUBLIC = join(WEB, 'public');
const RERENDER = 'pnpm --filter @luciel/web exec node scripts/render-site-icons.mjs';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Width and height from a PNG's IHDR chunk (it always comes first). */
function pngSize(png: Buffer): [number, number] {
  expect(png.subarray(0, 8).equals(PNG_SIGNATURE)).toBe(true);
  expect(png.subarray(12, 16).toString('latin1')).toBe('IHDR');
  return [png.readUInt32BE(16), png.readUInt32BE(20)];
}

/** The digests the renderer records. Line endings never change what the SVG draws. */
const textDigest = (text: string) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
const fileDigest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

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

  it('favicon.ico and apple-icon.png are the renders of the current icon.svg', () => {
    // Chrome and Edge show icon.svg, but Safari, the iOS home screen, Windows and crawlers
    // show the rasters: a mark changed in icon.svg alone would leave them the old one.
    const { sha256 } = JSON.parse(
      readFileSync(join(__dirname, 'site-icon-renders.json'), 'utf8'),
    ) as { sha256: Record<string, string> };
    expect(
      textDigest(readFileSync(join(APP, 'icon.svg'), 'utf8')),
      `icon.svg changed after favicon.ico and apple-icon.png were rendered; re-render: ${RERENDER}`,
    ).toBe(sha256['icon.svg']);
    for (const name of ['favicon.ico', 'apple-icon.png']) {
      expect(
        fileDigest(readFileSync(join(APP, name))),
        `${name} is not the file the renderer wrote; re-render: ${RERENDER}`,
      ).toBe(sha256[name]);
    }
  });
});

/**
 * Every root-relative file the shipped code names must exist where Next serves it: in
 * public/, or as a static metadata file at the top of src/app. The scan reads every string
 * in the modules (literals, template literal text and JSX attribute values, found by the
 * TypeScript parser, so comments and JSX text never count) and the stylesheets (comments
 * stripped) of apps/web/src, of the two packages the app renders from source (packages/ui,
 * and packages/design-tokens, whose tokens.css globals.css imports), and next.config.mjs and
 * tailwind.config.ts. Unit test files are left out: they never ship. A path spelled out in a
 * string is found in a srcSet list, in markup and in url(); one built at runtime
 * (`/brand/${name}.png`) cannot be checked here. Paths under /_next/ are the build's own.
 */
const STATIC_FILE =
  /(?<=^|[\s,"'`(=])\/(?!\/|_next\/)[\w\-./@%~+]*\.(?:ico|png|svg|jpe?g|gif|webp|avif|webmanifest|json|txt|xml|woff2?|ttf|otf|pdf|mp4|webm)(?=$|[\s,"'`)>?#])/gi;

/** The names Next 15 serves from the top of src/app (next/dist/lib/metadata/is-metadata-route.js). */
const APP_METADATA_FILE =
  /^(?:favicon\.ico|icon\d?\.(?:ico|jpe?g|png|svg)|apple-icon\d?\.(?:jpe?g|png)|(?:opengraph|twitter)-image\d?\.(?:jpe?g|png|gif)|robots\.txt|sitemap\.xml|manifest\.(?:json|webmanifest))$/;

const SHIPPED = [
  join(WEB, 'src'),
  join(REPO, 'packages', 'ui', 'src'),
  join(REPO, 'packages', 'design-tokens', 'src'),
  join(WEB, 'next.config.mjs'),
  join(WEB, 'tailwind.config.ts'),
];
const SOURCE_FILE = /\.(?:[cm]?[jt]sx?|css)$/;
const TEST_FILE = /\.test\.[cm]?[jt]sx?$/;

function scriptKind(file: string): ts.ScriptKind {
  if (file.endsWith('.tsx')) return ts.ScriptKind.TSX;
  if (file.endsWith('.jsx')) return ts.ScriptKind.JSX;
  return /\.[cm]?ts$/.test(file) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
}

/** The text of every string in a file: a module's strings, or a stylesheet without comments. */
function stringsIn(file: string, text: string): string[] {
  if (file.endsWith('.css')) return [text.replace(/\/\*[\s\S]*?\*\//g, '')];
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      found.push(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, scriptKind(file)));
  return found;
}

/** The root-relative static files a file's strings name, without any query or fragment. */
function staticRefs(file: string, text: string): string[] {
  return stringsIn(file, text).flatMap((s) => s.match(STATIC_FILE) ?? []);
}

function sourceFiles(path: string): string[] {
  if (statSync(path).isFile()) return [path];
  return readdirSync(path).flatMap((name) => {
    const full = join(path, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return SOURCE_FILE.test(name) && !TEST_FILE.test(name) ? [full] : [];
  });
}

const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() ?? false;

function isServed(ref: string): boolean {
  let path: string;
  try {
    path = decodeURIComponent(ref);
  } catch {
    return false;
  }
  if (isFile(join(PUBLIC, path))) return true;
  const name = posix.basename(path);
  return posix.dirname(path) === '/' && APP_METADATA_FILE.test(name) && isFile(join(APP, name));
}

describe('static files the app references', () => {
  it('the scan finds root-relative files in strings, srcSet lists, markup and CSS, and nothing else', () => {
    const named = [
      `<img src="/brand/hero.png" srcSet="/brand/hero-1x.png 1x, /brand/hero@2x.png 2x" />;`,
      `export const metadata = { icons: { icon: '/favicon.ico?v=2' } };`,
      'const mark = `<link rel="icon" href="/brand/mark.svg">`;',
      `const background = "url('/media/my%20bg.webp')";`,
    ].join('\n');
    expect(staticRefs('probe.tsx', named)).toEqual([
      '/brand/hero.png',
      '/brand/hero-1x.png',
      '/brand/hero@2x.png',
      '/favicon.ico',
      '/brand/mark.svg',
      '/media/my%20bg.webp',
    ]);
    const css = `a { background: url(/og.png) } /* url(/old.png) */ @font-face { src: url('/f/x.woff2') }`;
    expect(staticRefs('probe.css', css)).toEqual(['/og.png', '/f/x.woff2']);
    // Other hosts, the build's own files, routes and API paths, comments, JSX text, and a
    // path built at runtime.
    const ignored = [
      `// the browser asks for /from-a-comment.png`,
      `const urls = ['//cdn.example/a.png', 'https://cdn.example/b.png', '/_next/static/c.woff2'];`,
      `const routes = ['/dashboard', '/api/v1/admin/usage/export.csv?view=day'];`,
      'const built = `/brand/${name}.png`;',
      `const prose = <p>/from-jsx-text.png</p>;`,
    ].join('\n');
    expect(staticRefs('probe.tsx', ignored)).toEqual([]);
  });

  it('counts a file at the top of src/app as served only under a name Next 15 serves', () => {
    const served = [
      'favicon.ico',
      'icon.svg',
      'icon1.png',
      'apple-icon.png',
      'apple-icon2.jpeg',
      'opengraph-image.gif',
      'twitter-image.png',
      'robots.txt',
      'sitemap.xml',
      'manifest.webmanifest',
    ];
    const ignoredByNext = [
      'apple-icon.svg',
      'apple-icon.ico',
      'icon12.png',
      'favicon.png',
      'opengraph-image.webp',
      'logo.svg',
    ];
    expect(served.filter((name) => !APP_METADATA_FILE.test(name))).toEqual([]);
    expect(ignoredByNext.filter((name) => APP_METADATA_FILE.test(name))).toEqual([]);
    expect(isServed('/favicon.ico')).toBe(true);
    expect(isServed('/apple-icon.png')).toBe(true);
    expect(isServed('/brand/favicon.ico')).toBe(false);
    // next/font bundles the vendored font under /_next/; nothing serves it at a root path.
    expect(isServed('/fonts/inter-latin-wght-normal.woff2')).toBe(false);
  });

  it('every root-relative static file the shipped code names exists where Next serves it', () => {
    const files = SHIPPED.flatMap(sourceFiles);
    // The walk reaches every tree it should: a moved folder must not leave nothing to scan.
    expect(files).toEqual(
      expect.arrayContaining([
        join(APP, 'layout.tsx'),
        join(APP, 'globals.css'),
        join(REPO, 'packages', 'ui', 'src', 'Logo.tsx'),
        join(REPO, 'packages', 'design-tokens', 'src', 'tokens.css'),
        join(WEB, 'next.config.mjs'),
      ]),
    );
    const missing = files.flatMap((file) =>
      staticRefs(file, readFileSync(file, 'utf8'))
        .filter((ref) => !isServed(ref))
        .map((ref) => `${ref} (${relative(REPO, file).split(sep).join('/')})`),
    );
    expect(missing).toEqual([]);
  });
});
