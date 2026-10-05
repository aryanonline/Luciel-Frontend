import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The build must not depend on a live fetch from Google Fonts.
 *
 * `next/font/google` downloads the font files during `next build`. When Google
 * Fonts did not answer (scheduled CI, 2026-10-04) the build failed — and the
 * deploy image runs the same build, so an outage there would block a release.
 * The brand font is therefore vendored and loaded with `next/font/local`.
 */
const SRC = join(__dirname, '..', '..', 'src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.(ts|tsx|css)$/.test(name)) out.push(full);
  }
  return out;
}

describe('the brand font is self-hosted', () => {
  it('no source file loads a font from Google at build or run time', () => {
    const offenders = sourceFiles(SRC).filter((file) => {
      const text = readFileSync(file, 'utf8');
      return (
        /from\s+['"]next\/font\/google['"]/.test(text) ||
        /fonts\.googleapis\.com|fonts\.gstatic\.com/.test(text.replace(/\/\*[\s\S]*?\*\//g, ''))
      );
    });
    expect(offenders).toEqual([]);
  });

  it('the vendored font file and its licence ship with the app', () => {
    const fonts = join(SRC, 'app', 'fonts');
    const woff2 = join(fonts, 'inter-latin-wght-normal.woff2');
    expect(existsSync(woff2)).toBe(true);
    // A real WOFF2 file, not an empty placeholder: magic bytes "wOF2".
    expect(readFileSync(woff2).subarray(0, 4).toString('latin1')).toBe('wOF2');
    // OFL-1.1 requires the licence to travel with the font.
    expect(readFileSync(join(fonts, 'LICENSE-Inter.txt'), 'utf8')).toContain(
      'SIL OPEN FONT LICENSE',
    );
  });

  it('the root layout loads it through next/font/local', () => {
    const layout = readFileSync(join(SRC, 'app', 'layout.tsx'), 'utf8');
    expect(layout).toMatch(/from 'next\/font\/local'/);
    expect(layout).toContain("src: './fonts/inter-latin-wght-normal.woff2'");
    expect(layout).toContain("variable: '--font-inter'");
  });
});
