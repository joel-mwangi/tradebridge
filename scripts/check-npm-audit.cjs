#!/usr/bin/env node
"use strict";

const fs = require("node:fs");

const reportPath = process.argv[2];
if (!reportPath) {
  console.error("Usage: node scripts/check-npm-audit.cjs <npm-audit-json>");
  process.exit(2);
}

let report;
try {
  report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
} catch (error) {
  console.error("Unable to parse npm audit JSON:", error instanceof Error ? error.message : error);
  process.exit(2);
}

// Time-boxed exception for the single upstream-unpatched braces advisory and
// the dev-tool dependency chain that can only be remediated once braces ships
// a patched release. Any additional advisory or available fix remains blocking.
const allowedVia = {
  braces: ["https://github.com/advisories/GHSA-vfj7-8cjw-p6xm"],
  micromatch: ["braces"],
  "fast-glob": ["micromatch"],
  "@next/eslint-plugin-next": ["fast-glob"],
  "eslint-config-next": ["@next/eslint-plugin-next"],
};

const vulnerabilities = Object.entries(report.vulnerabilities ?? {});
const blocking = [];
const excepted = [];

for (const [name, vulnerability] of vulnerabilities) {
  if (!["high", "critical"].includes(vulnerability.severity)) continue;

  const expectedVia = allowedVia[name];
  const viaMatchesKnownChain =
    expectedVia &&
    Array.isArray(vulnerability.via) &&
    vulnerability.via.length > 0 &&
    vulnerability.via.every((item) => {
      const reference = typeof item === "string" ? item : item?.url;
      return expectedVia.includes(reference);
    });

  const eligibleForTemporaryException =
    viaMatchesKnownChain &&
    vulnerability.fixAvailable === false &&
    vulnerability.isDirect === false;

  if (eligibleForTemporaryException) {
    excepted.push(name);
  } else {
    blocking.push({ name, severity: vulnerability.severity, via: vulnerability.via });
  }
}

if (blocking.length > 0) {
  console.error("Unresolved high/critical dependency vulnerabilities:", JSON.stringify(blocking, null, 2));
  process.exit(1);
}

if (excepted.length) {
  console.warn(
    "Temporary exception for the unpatched braces advisory chain only: " +
    excepted.sort().join(", ") +
    ". This is development tooling, remains visible in npm audit, and must be rechecked by 2026-11-16."
  );
}
console.log(`Dependency audit gate passed: ${vulnerabilities.length} package(s) have advisories; no unexcepted high/critical issues remain.`);
