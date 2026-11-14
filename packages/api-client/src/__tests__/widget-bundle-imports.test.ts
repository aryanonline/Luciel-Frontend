import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The widget entrypoint's runtime imports, followed module by module. The widget ships on
 * customers' sites, so its schemas are zod/mini (`schemas/widget.ts`): a value import of
 * `zod` anywhere on this path would put the whole classic API (about 94 kB) back into the
 * bundle, and a value import of the schemas index would add every control-plane schema.
 * Type-only imports are erased at build time and do not count.
 */

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `import x from`, `import { a, type b } from`, `import * as n from`, `export { a } from`,
// `export * from`; a statement that starts `import type` / `export type` is erased.
const FROM =
  /^\s*(?:import|export)\s+(type\s+)?(?:\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+(?:\s*,\s*\{[^}]*\})?)\s+from\s+['"]([^'"]+)['"]/gm;
const BARE = /^\s*import\s+['"]([^'"]+)['"]/gm;

function runtimeImports(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const out: string[] = [];
  for (const m of text.matchAll(FROM)) if (!m[1]) out.push(m[2]!);
  for (const m of text.matchAll(BARE)) out.push(m[1]!);
  return out;
}

function resolveLocal(from: string, spec: string): string {
  const base = resolve(dirname(from), spec);
  for (const candidate of [`${base}.ts`, resolve(base, 'index.ts')]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(`cannot resolve ${spec} from ${relative(SRC, from)}`);
}

function walk(entry: string) {
  const modules = new Set<string>();
  const packages = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.pop()!;
    if (modules.has(file)) continue;
    modules.add(file);
    for (const spec of runtimeImports(file)) {
      if (spec.startsWith('.')) queue.push(resolveLocal(file, spec));
      else packages.add(spec);
    }
  }
  return {
    modules: [...modules].map((m) => relative(SRC, m).replace(/\\/g, '/')).sort(),
    packages: [...packages].sort(),
  };
}

describe('the widget entrypoint imports', () => {
  const { modules, packages } = walk(resolve(SRC, 'widget.ts'));

  it('zod only as zod/mini', () => {
    expect(packages).toEqual(['zod/mini']);
  });

  it('only the data-plane modules', () => {
    expect(modules).toEqual([
      'adapters/transport.ts',
      'adapters/widget-adapters.ts',
      'errors.ts',
      'schemas/rules.ts',
      'schemas/widget.ts',
      'widget-factory.ts',
      'widget.ts',
    ]);
  });
});
