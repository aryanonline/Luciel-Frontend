import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, loadAllowlist } from './image-scan-gate.mjs';

const allow = (entries) => loadAllowlist({ allow: entries });
const scan = (status, findings) => ({ imageScanStatus: { status }, imageScanFindings: { findings } });
const opts = { today: '2026-09-14', severities: ['CRITICAL', 'HIGH'] };
const entry = (cve, expires = '2026-10-14') => ({
  cve,
  package: 'perl',
  reason: 'r',
  added: '2026-09-14',
  expires,
});

test('an incomplete scan fails closed', () => {
  const r = evaluate(scan('IN_PROGRESS', []), allow([]), opts);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /not COMPLETE/);
});

test('a missing scan status fails closed', () => {
  assert.equal(evaluate({}, allow([]), opts).ok, false);
});

test('a HIGH finding blocks, not only CRITICAL', () => {
  const r = evaluate(scan('COMPLETE', [{ name: 'CVE-1', severity: 'HIGH' }]), allow([]), opts);
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /HIGH and not allowlisted/);
});

test('an allowlisted finding inside its window passes', () => {
  const r = evaluate(
    scan('COMPLETE', [{ name: 'CVE-1', severity: 'CRITICAL' }]),
    allow([entry('CVE-1')]),
    opts,
  );
  assert.equal(r.ok, true);
  assert.equal(r.blockingCount, 1);
});

test('an expired waiver whose CVE is still present fails', () => {
  const r = evaluate(
    scan('COMPLETE', [{ name: 'CVE-1', severity: 'CRITICAL' }]),
    allow([entry('CVE-1', '2026-09-13')]),
    opts,
  );
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /expired 2026-09-13/);
});

test('a waiver that no longer matches is a warning, not a failure', () => {
  const r = evaluate(scan('COMPLETE', []), allow([entry('CVE-9')]), opts);
  assert.equal(r.ok, true);
  assert.match(r.warnings[0], /no longer matches/);
});

test('MEDIUM findings never block', () => {
  const r = evaluate(scan('COMPLETE', [{ name: 'CVE-2', severity: 'MEDIUM' }]), allow([]), opts);
  assert.equal(r.ok, true);
});

test('a malformed allowlist is rejected', () => {
  assert.throws(() => loadAllowlist({ allow: [{ cve: 'CVE-1' }] }), /missing/);
  assert.throws(() => loadAllowlist({ allow: [entry('CVE-1'), entry('CVE-1')] }), /duplicate/);
  assert.throws(() => loadAllowlist({}), /no 'allow' list/);
});
