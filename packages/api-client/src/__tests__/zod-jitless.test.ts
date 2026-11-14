import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { z } from 'zod';

/**
 * zod's JIT stays off (`schemas/zod-setup.ts`). With it on, the first classic `z.object()`
 * zod 4 builds runs `new Function("")`, and the dashboard's production CSP, which has no
 * 'unsafe-eval', reported that as a securitypolicyviolation on every page load. zod reads
 * the flag when a schema is BUILT, so each case starts from fresh modules with the flag
 * cleared and checks what loading the package itself does.
 */

const RealFunction = globalThis.Function;

beforeEach(() => {
  vi.resetModules();
  Reflect.deleteProperty(z.config(), 'jitless');
});

afterEach(() => {
  globalThis.Function = RealFunction;
});

/** Record every use of the Function constructor, with `new` or without. */
function watchFunctionConstructor(): unknown[][] {
  const calls: unknown[][] = [];
  globalThis.Function = new Proxy(RealFunction, {
    construct(target, args, newTarget) {
      calls.push(args);
      return Reflect.construct(target, args, newTarget);
    },
    apply(target, thisArg, args) {
      calls.push(args);
      return Reflect.apply(target, thisArg, args);
    },
  });
  return calls;
}

describe("zod's JIT", () => {
  it('is off once the control-plane entrypoint has loaded', async () => {
    await import('../index');
    expect(z.config().jitless).toBe(true);
  });

  it('is off once contact.ts, the schema module that does not import common.ts, loads alone', async () => {
    await import('../schemas/contact');
    expect(z.config().jitless).toBe(true);
  });

  it('so building and parsing the schemas never calls the Function constructor', async () => {
    const calls = watchFunctionConstructor();
    let parsed: boolean[] = [];
    try {
      const { loginRequest, contactRequest } = await import('../schemas');
      parsed = [
        loginRequest.safeParse({ email: 'owner@example.com', password: 'x' }).success,
        contactRequest.safeParse({
          name: 'Ada',
          email: 'ada@example.com',
          message: 'A question about pricing.',
          captchaToken: 'token',
        }).success,
      ];
    } finally {
      globalThis.Function = RealFunction;
    }
    expect(parsed).toEqual([true, true]);
    expect(calls).toEqual([]);
  });
});
