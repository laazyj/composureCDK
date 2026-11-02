/**
 * The policy behind `scripts/dependency-review.mjs`, apart from its I/O so it
 * can be tested without the GitHub API. See docs/ci.md#dependency-review.
 */

/**
 * Advisories accepted repo-wide, so they never fail a PR. Each needs a comment
 * saying why, and when it can go.
 */
const ALLOWED_GHSAS = new Set([]);

/**
 * The advisories a PR introduces: those on an added package version that no
 * removed version of the same package had. Low severity doesn't count; any
 * other value does, so an unrecognised one fails.
 *
 * @param changes Entries from the dependency graph compare API. Anything else
 *   throws: this decides whether a PR is safe, so it must not read a response
 *   it doesn't understand as "nothing to report".
 */
export function netNewAdvisories(changes, allowed = ALLOWED_GHSAS) {
  for (const change of changes) {
    if (!["added", "removed"].includes(change?.change_type) || !change.vulnerabilities) {
      throw new Error(`Unexpected dependency change: ${JSON.stringify(change)}`);
    }
  }

  const key = (change, vulnerability) => `${change.name} ${vulnerability.advisory_ghsa_id}`;
  const ofType = (type) => changes.filter((change) => change.change_type === type);

  const existing = new Set(
    ofType("removed").flatMap((change) => change.vulnerabilities.map((v) => key(change, v))),
  );

  return ofType("added").flatMap((change) =>
    change.vulnerabilities
      .filter(
        (v) =>
          v.severity !== "low" && !allowed.has(v.advisory_ghsa_id) && !existing.has(key(change, v)),
      )
      .map((v) => ({
        manifest: change.manifest,
        name: change.name,
        version: change.version,
        severity: v.severity,
        ghsa: v.advisory_ghsa_id,
        summary: v.advisory_summary,
        url: v.advisory_url,
      })),
  );
}
