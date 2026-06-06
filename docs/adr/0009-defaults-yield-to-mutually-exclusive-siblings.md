# ADR 0009: Defaults yield to a mutually-exclusive user-set sibling prop

- **Status:** Accepted
- **Date:** 2026-06-06

## Context

Builders apply defaults with a single spread in `build()`:
`{ ...DEFAULTS, ...this.props }`. The defaults doctrine
([architecture.md](../architecture.md#defaults)) promises that every default
is "individually overridable through the existing fluent API." Because user
values are spread last, a user value overrides a default **on the same key**.

Some CDK props are mutually exclusive with a sibling: setting one forbids the
other. `VpcProps` is the first case in the library — CDK rejects a `Vpc`
configured with both `availabilityZones` and `maxAzs`. `VPC_DEFAULTS` ships
`maxAzs: 2` (a deliberate cost/HA balance). A user who sets
`availabilityZones` — the supported way to pin AZs for a deterministic,
credential-free `cdk synth` — finds the default `maxAzs` still present in the
merged props, because it lives on a _different_ key. Synth then fails with
`Vpc supports 'availabilityZones' or 'maxAzs', but not both`
(issue [#153](https://github.com/laazyj/composureCDK/issues/153)).

The default was effectively un-overridable through its legitimate sibling API,
contradicting the doctrine. The existing build-time mutual-exclusivity pattern
in `function-builder.ts` and `certificate-builder.ts` covers _user-vs-user_
conflicts (throw when two user choices collide); this is the new
_default-vs-user_ dimension.

## Decision

When a default-supplied prop is mutually exclusive with a sibling prop, the
builder resolves the conflict in `build()`:

1. **If the user sets the sibling and not the default's key**, omit the
   conflicting default from the merge. User intent wins silently — this is the
   same "user value takes precedence over a default" guarantee, extended to a
   sibling key.
2. **If the user sets both keys explicitly**, throw a descriptive error. This
   is a genuine user conflict, indistinguishable in a flat `props` record from
   either order of assignment, so it fails fast rather than guessing.

The default value itself is left in `defaults.ts` unchanged — the resolution
is purely a `build()`-time merge concern.

## Consequences

- Pinned-AZ VPCs synth offline without dropping the cost-conscious 2-AZ
  default for everyone, and the default stays auditable in `VPC_DEFAULTS`.
- A small amount of conflict-aware logic lives in `build()`, mirroring the
  existing mutual-exclusivity throws. Builder authors adding a default that is
  mutually exclusive with a sibling must apply this rule.
- The fix is per-instance. If default-vs-sibling collisions recur, that is the
  signal to weigh a generic, typed primitive in `@composurecdk/core` rather
  than repeating the pattern; an untyped `.unset()` escape hatch was rejected
  for pushing the burden onto users and leaking which props are defaults.
