# ADR 0019: Lint rules as public contract — preset tiers and rule semver

- **Status:** Accepted
- **Date:** 2026-09-19

## Context

`@composurecdk/eslint-plugin` encodes invariants of the `Lifecycle`/builder
contract — forward your build context, brand instead of `instanceof`, keep a
`[COPY_STATE]` hook. While the package is private those invariants are enforced
only inside this repo, so a consumer writing their own builder gets none of
them, and the failure they were meant to prevent reaches them at synth time
instead ([#409](https://github.com/laazyj/composureCDK/issues/409)).

Publishing the plugin is straightforward. Deciding **which rules a consumer
should get** is not, and the single `recommended` preset cannot express it.
Three rules are wrong outside this repo — `no-cdk-api-above-floor` bans a fixed
list of APIs above _our_ version floor, `builder-must-be-tagged` mandates a
specific dependency, `constraint-metadata-required` keys on our constraint
catalogue. Shipping them to a consumer on a different floor is worse than not
publishing: a rule that misfires teaches people to disable the whole plugin.

A two-way split into "consumer" and "internal" looked sufficient and is not.
`no-cjs-incompatible-syntax` bans `import.meta` because it has no CommonJS emit
— true for a dual-published package, and a false positive for an ESM-only
library where `import.meta.url` is legal and idiomatic. It belongs to neither
tier. The axis that actually separates the rules is not _whose repo_ but
_what is true of the consumer_.

A second condition surfaced the same way. Three rules guard hazards that exist
only once a package emits a `.d.ts` someone else compiles against — TS4094 and
TS2883 need an exported mapped type, and a narrowed prop type only hurts when it
is your published API. A fourth, `lifecycle-build-must-forward-context`, reports
on root-level builds, which are a handful of sites in a library and very nearly
every build in an application. This repo already carried that cost as two
`eslint-disable` comments in `packages/cloudformation/src` and a blanket
exclusion for `packages/examples/src` — the latter written as a rule override,
which is exactly the "the preset is wrong for you, work around it" state the
tiering removes.

Once published, rule names, messages and default severities become API. A rule
that gets stricter breaks a consumer's CI, and nothing about the change looks
like a breaking release unless that is stated in advance.

## Decision

**Rules are grouped by what must be true of the consumer for the rule to be
correct, and each rule sits in exactly one tier.**

| Preset           | True for                                                           |
| ---------------- | ------------------------------------------------------------------ |
| `recommended`    | Anyone writing a `Lifecycle` or a builder, in any shape of project |
| `libraryAuthor`  | Additionally, a package others compile against                     |
| `dualPublishing` | Additionally, a package shipping both ESM and CommonJS             |
| `internal`       | composureCDK itself                                                |

Which rules sit in which tier is deliberately **not** listed here — that roster
changes, and this document does not. It lives in the package README's rules
table, which the "adding a new rule" checklist maintains and a test gates.

The tiers are additive. This repo extends all four; a CDK application extends
`recommended` alone, and is neither told off for `import.meta` nor for the root
builds it makes as a matter of course.

**`lifecycle-build-must-forward-context` is in `libraryAuthor` because no
narrowing fixes it.** A root build is a real `Lifecycle` builder, correctly
called with two arguments — whether an enclosing context exists is a property of
the call's position in the composition graph, not of its syntax or its type. A
type-aware version would remove the unrelated-`build()` collisions and still
report every root build.

**`no-realm-bound-instanceof` stays in `recommended` despite being a
dual-publishing rule in origin.** Its hazard is not confined to the linted
package: any _dependency_ can turn up twice in a process — two versions npm
could not dedup, a bundler that duplicated one, a dual-published package whose
halves both loaded. None of that is visible from the linted source, so a
single-format consumer still wants the rule on. Its relative-import half is
narrower — it needs only that nothing can install the linted package twice,
which is not the same as shipping one module format — so it is an option on the
rule rather than a tier ([#450](https://github.com/laazyj/composureCDK/issues/450)).

### Semver

- **Rule names, messages, default severities and preset names are public API.**
- **A new rule ships registered but in no preset**, so a consumer can enable it
  the day it lands. It **joins a preset in a major**. A caret range — what
  `npm install` writes — picks up every later minor automatically, so a rule
  added to a preset in a minor turns green CI red on unchanged code with no
  decision taken. This is also why ESLint core and typescript-eslint only add to
  their `recommended` in a major.
- **Tightening an existing rule is breaking** — anything that makes it report
  where it previously did not, including a widened selector or a narrowed
  exemption. New code failing an unchanged rule is not.
- **Loosening, removing or renaming a rule is breaking.** Loosening removes
  coverage; a removed or renamed rule id in a consumer's own `rules:` block is a
  hard config error rather than a silent gap.
- **Moving a rule between presets, or renaming a preset, is breaking.** Adding a
  new preset is not.
- **Adding an option is minor when its default preserves behaviour**, and
  breaking otherwise.

## Consequences

- Adding a rule now means choosing its tier, and the choice is load-bearing:
  a rule in `recommended` that is not true for every consumer is a false
  positive in the preset that is meant to be safe by default.
- Two tests hold the tiering together. One asserts no rule appears in two
  presets, since that makes its severity depend on extend order. The other lists
  the rules deliberately in no preset — awaiting the next major — so that
  "waiting" stays distinguishable from "forgotten".
- This repo is the split's first consumer, and its own packages take three
  different tier sets. Libraries take all four. `packages/examples` takes
  `recommended` alone — the examples are CDK applications, publishing nothing
  and emitting no `.d.ts` — which deletes the rule override that had silenced
  `lifecycle-build-must-forward-context` across the whole package. The tier now
  says what the override used to.
- `packages/cdk-testing` is the interesting case: single-format, so the
  dual-publishing rules are off, but `internal` stays. It declares no
  `aws-cdk-lib` floor, yet 17 floor-declaring packages depend on it and their
  `test` target depends on `^build`, so its code runs under every one of their
  floors. A package inherits the strictest floor of anything that depends on
  it, which is not visible from its own manifest.
- Each rule's documentation page and the README table both name the rule's tier,
  and both are asserted against `configs`. A tier move is breaking, so the pages
  a consumer reads to choose a tier cannot quietly disagree with the code.
- `internal` is published rather than kept back. It costs nothing, it makes this
  repo's own config reproducible from the package, and it documents the
  distinction instead of hiding it.
- The tiers describe the consumer, not the subject matter, so a future rule
  about (say) alarm naming does not get its own preset — it gets whichever tier
  its truth condition matches.

## Alternatives considered

- **One preset, and two tiers,** both rejected for the false positives set out
  in the Context above.
- **A preset per subject** (`lifecycle`, `publishing`, `builders`). Reads
  tidily and answers the wrong question: a consumer does not want "the
  publishing rules", they want the rules that are true for them.
- **Publish nothing and keep documenting.** Already tried. `docs/architecture.md`
  gained the conduit case, and it is the page a conduit builder's author is
  least likely to read, precisely because their own class holds no `Resolvable`.
