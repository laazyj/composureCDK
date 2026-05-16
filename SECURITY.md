# Security Policy

ComposureCDK is a TypeScript library that generates AWS infrastructure. A
vulnerability here can end up deployed into other people's AWS accounts, so we
take reports seriously and want them routed privately.

If you believe you've found a security issue, please report it through the
process below rather than opening a public issue.

## Reporting a vulnerability

Use GitHub's **Private Vulnerability Reporting** flow:

[**Report a vulnerability →**](https://github.com/laazyj/composureCDK/security/advisories/new)

(Or: navigate to the **Security** tab on the repository, then choose
_Report a vulnerability_.)

Helpful things to include:

- Affected package(s) and version(s) (e.g. `@composurecdk/s3@0.4.2`).
- A minimal reproduction — ideally a synth-able snippet plus the resulting
  CloudFormation excerpt that demonstrates the problem.
- Your assessment of impact and any known mitigations.

## Response expectations

- **Acknowledgement** within 3 working days.
- **Triage decision** (accept / decline / need more info) within 7 working days.
- **Fix or mitigation** targeted within 30 days for high-severity issues, 90 days
  for everything else. Where exploitation is active or trivial, we'll move
  faster and may issue an interim advisory.

## Supported versions

ComposureCDK is pre-1.0. Only the **latest published minor** of each
`@composurecdk/*` package receives security fixes. Users on older versions
should upgrade to receive a fix.

## Scope

### In scope

- Any published package under `@composurecdk/*`, on its latest minor.
- **Divergence between documented secure defaults and emitted CloudFormation** —
  e.g. an S3 builder that documents "public access blocked" but synthesizes a
  template that allows public access. This is the core promise of the library
  and we treat it as a security defect, not a behaviour change.
- IAM role and policy builders that grant broader permissions than their API
  surface implies (privilege escalation, unintended wildcards, confused-deputy
  patterns).
- `@composurecdk/eslint-plugin` — it ships to users and influences code that
  goes to production.
- Any runtime code shipped in a published package (e.g. CloudFront viewer
  functions, Lambda helper code), now or in the future.
- The release pipeline under `.github/workflows/` — anything that produces a
  published artifact, including the OIDC trust configuration used by CI.

### Out of scope

- Vulnerabilities in upstream dependencies (`aws-cdk-lib`, `constructs`, etc.).
  Please report those upstream; Dependabot picks them up here automatically.
- Bugs or misconfigurations in the consumer's own application code, CDK app, or
  AWS account. Overriding a default is a supported and intentional part of the
  API — overriding a secure default to something less secure is the caller's
  decision, not a library vulnerability.
- The `packages/examples/` contents. Examples are illustrative and are not a
  security boundary; report design questions about them as regular issues.
- Feature requests for stricter defaults that aren't already documented as such
  (e.g. "the default cache policy could be tighter for my use case"). These are
  valuable — please open a normal issue or discussion — but they aren't
  vulnerabilities.
- Findings against forks or third-party copies of this code.
- Reports requiring physical access, social engineering, or compromise of
  maintainer accounts.

### Examples

To make the line concrete:

- **In scope:** `BucketBuilder` documents `blockPublicAccess: true` as the
  default, but the synthesized template emits `BlockPublicAcls: false`.
- **In scope:** a role builder accepts a list of granted actions and silently
  expands `s3:GetObject` to `s3:*` in the resulting policy document.
- **Out of scope:** "the default Lambda runtime is older than I'd like" — open
  an issue.
- **Out of scope:** a user calls a builder with `publicReadAccess: true` and
  is surprised the bucket is public.

## Coordinated disclosure

- Accepted reports are tracked as GitHub Security Advisories. A CVE will be
  requested via GHSA for any high-severity issue.
- We default to a **90-day embargo** from acknowledgement, shortened if a fix
  ships sooner or if the issue is being actively exploited.
- Reporters are credited in the advisory by name or handle, unless you ask us
  not to. Anonymous reports are welcome.

## Using ComposureCDK safely

A short checklist for downstream users:

- **Watch advisories.** Subscribe to this repository's security advisories on
  GitHub, or follow Dependabot alerts in your own repo.
- **Pin and review upgrades.** Pre-1.0, minor releases may change defaults.
  Pinning exact versions (or using a lockfile) and reviewing the changelog
  before bumping keeps surprises out of production.
- **Verify package integrity.** `npm audit signatures` validates that installed
  `@composurecdk/*` packages were published by the expected registry account.
- **Diff your synth.** `cdk diff` against a known-good baseline is the most
  reliable way to catch unintended changes to security-relevant properties
  (IAM, S3 ACLs, security group rules) when upgrading any CDK library —
  including this one.

Thanks for taking the time to report responsibly.
