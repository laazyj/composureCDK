// Import probe for the cdk-floors `enforce` mode (and the future `establish`
// sweep). Runs inside a rig that has a pinned aws-cdk-lib + the packed
// @composurecdk packages installed. Attempts to load each package (which
// executes its top-level aws-cdk-lib imports) and reports, as JSON on stdout,
// whether it loaded and — if not — the first error.
//
// Package names come in via the CDK_FLOOR_PACKAGES env var (JSON array).

const packages = JSON.parse(process.env.CDK_FLOOR_PACKAGES ?? "[]");
const results = [];

for (const name of packages) {
  try {
    await import(name);
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, error: error.message.split("\n")[0] });
  }
}

process.stdout.write(JSON.stringify(results));
