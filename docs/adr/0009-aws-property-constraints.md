# ADR 0009: AWS-property constraints — a catalogue with central mechanism and local data

- **Status:** Accepted
- **Date:** 2026-06-06

## Context

AWS rejects malformed property strings — character sets beyond an allowed set, over-length values — at deploy time, hours after `cdk synth`. While integration-testing the SecurityGroup builder, an em-dash (`—`) in a `GroupDescription` reached CloudFormation and failed at CREATE*FAILED with *"Character sets beyond ASCII are not supported."\_ A synth-time check would have caught it at the authoring call site.

The monorepo already had three such validators, added in isolation, with three return conventions and three homes:

| Helper                                                       | Package                                             | Shape                         |
| ------------------------------------------------------------ | --------------------------------------------------- | ----------------------------- |
| `sanitizeConstructId` / `constructId`                        | `@composurecdk/core`                                | transforms unsafe chars → `-` |
| `validateTag` / `validateTagRecord`                          | `@composurecdk/cloudformation`                      | throws on invalid input       |
| `alarmName` (branded `AlarmName`), `email` (branded `Email`) | `@composurecdk/cloudwatch`, `@composurecdk/budgets` | throws + branded type         |

Each re-implemented the same skeleton — empty/length check, character-set regex, throw with an "allowed" message. As more builders land, more AWS properties with character-set/length constraints will need the same treatment. Without a convention we keep rediscovering the pattern.

Two axes had to be decided: **where the constraint catalogue lives**, and **how/when a constraint is applied**.

## Decision

**Split the catalogue: a shared mechanism lives centrally; per-resource constraint data lives in the package that owns the builder. Discoverability is a convention plus a generated index, not a runtime aggregate.**

1. **Mechanism is central, in `@composurecdk/cloudformation`.** `StringConstraint` + the `stringConstraint()` factory, `validateString` (throws) / `sanitizeString` (transforms), and shared character-class fragments (`ALNUM`, `AWS_NAME_PUNCT`). `cloudformation` is chosen over a new package because it is already a near-universal peer dependency of the builder packages, already CDK-aware, and already home to `validateTag`. It is chosen over `core` because `core` is the CDK-agnostic primitive layer and must not grow an AWS regex catalogue.

2. **Constraint data is local to the owning package.** `SECURITY_GROUP_DESCRIPTION` and its `validate*` wrapper live in `@composurecdk/ec2`, next to the builder that enforces them. This follows the precedent already in the tree — `AlarmName` is local to `cloudwatch` — and keeps cohesion: one PR adds a builder _and_ its constraints. **Cross-cutting constraints are the exception**: tags apply to every resource, so `validateTag` stays central, now riding `validateString`.

3. **Construct-ID helpers stay in `core`.** `constructId` / `sanitizeConstructId` concern the `constructs` path separator, not an AWS property; they are not migrated.

4. **Throw vs. transform is a naming convention over one catalogue entry.** `validate*` (throws) for **user-authored** values the author can fix — SG description, tag key/value. `sanitize*` (transforms) for **derived** values the author does not control — e.g. a DNS name composed into a construct ID, where rewriting is the only sensible move. Both read from the same `StringConstraint`.

5. **Every error names the allowed set and links the AWS doc.** `StringConstraint.allowed` and `.source` are required fields, surfaced in the `validateString` message, so a synth-time error is more useful than the deploy-time AWS one.

6. **Validators fire at the builder's `build()`, guarded against tokens.** `build()` is the enforcement site, but the `validate*`/`sanitize*` functions are standalone exports, reusable from tests and manual composition. Unresolved CDK `Token`s are skipped — their value is not knowable at synth.

7. **Discoverability without import weight.** Each builder package exports a `constraints` object of the shared `ConstraintNamespace` shape (`constraints.validate.*` / `constraints.sanitize.*`), so the calling pattern is identical everywhere and a consumer imports only the package they already use. A single browsable index of the whole catalogue is left to a generated doc (a follow-up), **not** a top-of-graph aggregator package — that would force a consumer of one service to transitively import every other service just for autocomplete.

8. **Constraint, not style.** The catalogue is about making a value _legal_ (or failing). Stylistic reformatting — camelCase→kebab, PascalCase slugs — is a builder's naming choice and stays local to it; it is out of scope here.

## Consequences

- Each new constraint is a one-file change in the owning package: add a `stringConstraint` entry and a `validate*`/`sanitize*` wrapper, then call it from `build()`.
- A shared fragment graduates to `cloudformation`'s `char-sets` only once a _second_ property needs it — promotion is a one-line move plus an import change, with no builder API change and no dependency inversion (arrows only point service → cloudformation).
- `validateTag` keeps its public signature; `taggedBuilder` and all callers are untouched. The empty-key and reserved-`aws:`-prefix rules remain tag-specific and bespoke.
- Branded types (`AlarmName`, `Email`) remain valid where compile-time guarantees matter; they layer over `validateString` rather than competing with it. Migrating them is deferred.
- A holistic synth-time Aspect keyed by CFN resource type (catching raw CDK and late-added constructs) remains a complementary, opt-in follow-up. When built it should consume a registry or CFN-spec-generated map, not import each package.

## Alternatives considered

- **A dedicated `@composurecdk/constraints` package as the catalogue home.** Rejected: `cloudformation` already carries the dependencies and the `validateTag` precedent, so a new package adds tshy/`module-compat`/peer-dep/version overhead for no conceptual gain. The reasons usually cited for it ("keep the catalogue out of core", "the Aspect is CDK-aware") are arguments against `core`, which `cloudformation` does not share.
- **A single central namespace object aggregating every service's validators.** Rejected: a runtime `validate.*` object that knows every AWS property must import every service package, inverting the dependency graph and forcing a consumer of one service to pull in all of them. Discoverability is instead carried by a uniform per-package shape plus a generated index.
- **Central constraint _data_ (all regexes in one file).** Rejected: it would make `cloudformation` an all-services regex dump and break the one-PR-per-builder cohesion the local layout preserves. The shared mechanism is central; only genuinely cross-cutting data (tags) lives with it.
- **A declarative per-builder constraint map applied by a decorator (ADR-0006 style).** Deferred: it removes call-site boilerplate but pays the decorator-stacking cost and cannot see resolved refs. Reach for it only if call-site boilerplate proves painful.
