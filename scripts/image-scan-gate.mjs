#!/usr/bin/env node
/**
 * Image CVE gate with a governed allowlist (round 7 WP-0; Architecture §5.14).
 *
 * Mirrors the backend's `scripts/check_image_scan.py`. The inline shell gate it
 * replaces failed OPEN (an ECR API error or an unfinished scan printed "CVE gate
 * passed"), blocked only CRITICAL, and carried an undated allowlist. This gate:
 *
 *   - fails CLOSED when the scan is not COMPLETE or the findings cannot be read;
 *   - blocks any CRITICAL or HIGH finding not in `.security/cve-allowlist.json`;
 *   - fails when a listed CVE is still present past its entry's `expires` date
 *     (an expiry forces a human re-review; renewing means editing the file in a
 *     reviewed commit, never a quiet extension);
 *   - warns when a listed CVE no longer matches anything, so housekeeping is visible.
 *
 *   node scripts/image-scan-gate.mjs <scan-findings.json> <allowlist.json> [--today YYYY-MM-DD] [--severities CRITICAL,HIGH]
 *
 * <scan-findings.json> is the unmodified output of `aws ecr describe-image-scan-findings`.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const REQUIRED = ['cve', 'package', 'reason', 'added', 'expires'];

export function loadAllowlist(raw) {
  if (!raw || !Array.isArray(raw.allow)) throw new Error("allowlist has no 'allow' list");
  const byCve = new Map();
  for (const entry of raw.allow) {
    const missing = REQUIRED.filter((f) => !entry || !entry[f]);
    if (missing.length) throw new Error(`allowlist entry ${entry?.cve ?? '?'} missing ${missing.join(', ')}`);
    for (const f of ['added', 'expires']) {
      if (Number.isNaN(Date.parse(`${entry[f]}T00:00:00Z`))) {
        throw new Error(`allowlist entry ${entry.cve}: bad date in '${f}'`);
      }
    }
    if (byCve.has(entry.cve)) throw new Error(`duplicate allowlist entry ${entry.cve}`);
    byCve.set(entry.cve, entry);
  }
  return byCve;
}

export function evaluate(scan, allowlist, { today, severities }) {
  const status = String(scan?.imageScanStatus?.status ?? '');
  if (status !== 'COMPLETE') {
    return {
      ok: false,
      errors: [`scan status is '${status || 'absent'}', not COMPLETE — failing closed`],
      info: [],
      warnings: [],
      blockingCount: 0,
    };
  }
  const blocking = new Set(severities.map((s) => s.trim().toUpperCase()).filter(Boolean));
  const findings = (scan?.imageScanFindings?.findings ?? []).filter((f) =>
    blocking.has(String(f.severity ?? '').toUpperCase()),
  );
  const errors = [];
  const info = [];
  const warnings = [];
  const present = new Set();
  for (const f of findings) {
    const cve = String(f.name ?? '');
    present.add(cve);
    const entry = allowlist.get(cve);
    if (!entry) {
      errors.push(`${cve}: ${String(f.severity).toUpperCase()} and not allowlisted`);
    } else if (today > entry.expires) {
      errors.push(
        `${cve}: allowlist entry expired ${entry.expires} and the CVE is still present — re-review it and extend 'expires' in a commit, or fix the image`,
      );
    } else {
      info.push(`[gate] ${cve} (${entry.package}) allowlisted until ${entry.expires}`);
    }
  }
  for (const cve of allowlist.keys()) {
    if (!present.has(cve)) warnings.push(`allowlist entry ${cve} no longer matches any finding — remove it`);
  }
  return { ok: errors.length === 0, errors, info, warnings, blockingCount: findings.length };
}

export function main(argv) {
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      i += 1; // skip the option's value
    } else {
      positional.push(argv[i]);
    }
  }
  const opt = (name, fallback) => {
    const i = argv.indexOf(name);
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
  };
  const [scanFile, allowlistFile] = positional;
  if (!scanFile || !allowlistFile) {
    console.error(
      'usage: image-scan-gate.mjs <scan-findings.json> <allowlist.json> [--today YYYY-MM-DD] [--severities CRITICAL,HIGH]',
    );
    return 2;
  }
  const today = opt('--today', new Date().toISOString().slice(0, 10));
  const severities = opt('--severities', 'CRITICAL,HIGH').split(',');
  let scan;
  let allowlist;
  try {
    scan = JSON.parse(readFileSync(scanFile, 'utf8'));
  } catch (err) {
    console.error(`::error::image-scan gate: cannot read scan findings (${err.message}) — failing closed`);
    return 1;
  }
  try {
    allowlist = loadAllowlist(JSON.parse(readFileSync(allowlistFile, 'utf8')));
  } catch (err) {
    console.error(`::error::image-scan gate: allowlist invalid (${err.message}) — failing closed`);
    return 1;
  }
  const result = evaluate(scan, allowlist, { today, severities });
  for (const line of result.info) console.log(line);
  for (const line of result.warnings) console.log(`::warning::${line}`);
  for (const line of result.errors) console.error(`::error::${line}`);
  if (!result.ok) return 1;
  console.log(
    `[gate] PASS — ${result.blockingCount} blocking finding(s) (${severities.join('/')}), all under governed exceptions`,
  );
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main(process.argv.slice(2)));
}
