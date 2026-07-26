#!/usr/bin/env node
// Fails the build when `cdk synth` produced CloudFormation Validate findings.
//
// The report has to be inspected explicitly because synth exits 0 regardless.
// The `@aws-cdk/core:validateAgainstDefaultRules` flag only stops aws-cdk-lib
// downgrading *error*-severity findings, and every rule this ruleset currently
// raises against the examples is warning severity (W2001, W3010, ...).
//
// Usage: node scripts/check-validation-report.mjs <validation-report.json>
import { readFileSync } from "node:fs";

const reportPath = process.argv[2];
let report;

try {
  report = JSON.parse(readFileSync(reportPath, "utf8"));
} catch (error) {
  // No report means the plugin never ran — fail rather than pass silently.
  console.error(`Cannot read validation report at ${reportPath}: ${error.message}`);
  process.exit(1);
}

const violations = (report.pluginReports ?? []).flatMap((plugin) => plugin.violations ?? []);

if (violations.length === 0) {
  console.log("CloudFormation Validate: no findings.");
  process.exit(0);
}

console.error(`CloudFormation Validate reported ${violations.length} finding(s):\n`);
for (const violation of violations) {
  const rule = violation.ruleMetadata?.ruleId ?? violation.ruleName ?? "unknown";
  console.error(`  [${violation.severity}] ${rule}: ${violation.description ?? ""}`);
  for (const target of violation.violatingConstructs ?? []) {
    console.error(`      at ${target.constructPath ?? target.resourceLogicalId ?? "?"}`);
  }
}
process.exit(1);
