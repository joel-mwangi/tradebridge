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

const vulnerabilities = Object.entries(report.vulnerabilities ?? {});
const allowedUnpatchedBracesAdvisory = "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm";
const blocking = [];

for (const [name, vulnerability] of vulnerabilities) {
  if (!["high", "critical"].includes(vulnerability.severity)) continue;

  const onlyKnownUnpatchedBracesAdvisory =
    name === "braces" &&
    vulnerability.fixAvailable === false &&
    vulnerability.isDirect === false &&
    Array.isArray(vulnerability.via) &&
    vulnerability.via.length > 0 &&
    vulnerability.via.every((item) =>
      typeof item === "object" && item.url === allowedUnpatchedBracesAdvisory
    );

  if (!onlyKnownUnpatchedBracesAdvisory) {
    blocking.push({ name, severity: vulnerability.severity, via: vulnerability.via });
  }
}

if (blocking.length > 0) {
  console.error("Unresolved high/critical dependency vulnerabilities:", JSON.stringify(blocking, null, 2));
  process.exit(1);
}

const allowed = vulnerabilities.filter(([name, vulnerability]) =>
  name === "braces" &&
  vulnerability.severity === "high" &&
  vulnerability.fixAvailable === false &&
  Array.isArray(vulnerability.via) &&
  vulnerability.via.length > 0 &&
  vulnerability.via.every((item) =>
    typeof item === "object" && item.url === allowedUnpatchedBracesAdvisory
  )
);

if (allowed.length) {
  console.warn(
    "Temporary audit exception: braces has no published patched release for GHSA-vfj7-8cjw-p6xm. " +
    "It is a transitive development-tool dependency, is not pinned as a direct dependency, and remains visible in this audit. " +
    "Recheck upstream before 2026-11-16; remove this exception as soon as a fix is available."
  );
}
console.log(`Dependency audit gate passed: ${vulnerabilities.length} package(s) have advisories; no unexcepted high/critical issues remain.`);
