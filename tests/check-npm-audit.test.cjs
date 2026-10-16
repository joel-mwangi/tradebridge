const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const checker = path.resolve(__dirname, "../scripts/check-npm-audit.cjs");

function runChecker(vulnerabilities) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tradebridge-audit-"));
  const file = path.join(dir, "audit.json");
  try {
    fs.writeFileSync(file, JSON.stringify({ vulnerabilities }));
    return spawnSync(process.execPath, [checker, file], { encoding: "utf8" });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("allows only the exact upstream braces advisory and its known tooling chain", () => {
  const report = {
    braces: { severity: "high", isDirect: false, via: [{ url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" }] },
    micromatch: { severity: "high", isDirect: false, via: ["braces"] },
    "fast-glob": { severity: "high", isDirect: false, via: ["micromatch"] },
    "@next/eslint-plugin-next": { severity: "high", isDirect: false, via: ["fast-glob"] },
    "eslint-config-next": { severity: "high", isDirect: true, via: ["@next/eslint-plugin-next"] },
  };
  const result = runChecker(report);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stderr, /Temporary exception/);
});

test("fails closed for unrelated high severity vulnerabilities", () => {
  const result = runChecker({
    braces: { severity: "high", isDirect: false, via: [{ url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" }] },
    "some-runtime-package": { severity: "high", isDirect: true, via: [{ url: "https://example.com/advisory" }] },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /some-runtime-package/);
});

test("does not allow direct runtime braces or a different braces advisory", () => {
  const direct = runChecker({
    braces: { severity: "high", isDirect: true, via: [{ url: "https://github.com/advisories/GHSA-vfj7-8cjw-p6xm" }] },
  });
  assert.equal(direct.status, 1);
  const unknown = runChecker({
    braces: { severity: "high", isDirect: false, via: [{ url: "https://example.com/different-advisory" }] },
  });
  assert.equal(unknown.status, 1);
});
