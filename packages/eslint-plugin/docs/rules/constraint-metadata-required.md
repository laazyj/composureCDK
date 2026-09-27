# composurecdk/constraint-metadata-required

Requires every `stringConstraint({ … })` call to set a non-empty `name`, `allowed`, and `source`.

- **Preset:** `internal` (`error`)
- **Decision:** [ADR-0010](https://github.com/laazyj/composureCDK/blob/main/docs/adr/0010-aws-property-constraints.md)

## Why

Those three fields are the whole value of a synth-time validation error. They name the property, list the allowed character set, and link the AWS documentation — turning "deployment failed" into something the author can act on at the call site.

The factory's type already makes the keys required, so the rule's real job is what the type checker cannot see: a present-but-empty literal such as `allowed: ""` compiles fine while silently degrading every message the constraint produces.

## ❌ Incorrect

```ts
const GROUP_DESCRIPTION = stringConstraint({
  name: "EC2 SecurityGroup GroupDescription",
  charClass: "a-zA-Z0-9 ._\\-:/()#,@\\[\\]+=&;{}!$*",
  allowed: "",
  source: "",
});
```

## ✅ Correct

```ts
const GROUP_DESCRIPTION = stringConstraint({
  name: "EC2 SecurityGroup GroupDescription",
  charClass: "a-zA-Z0-9 ._\\-:/()#,@\\[\\]+=&;{}!$*",
  allowed: "letters, digits, spaces and ._-:/()#,@[]+=&;{}!$*",
  source:
    "https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-ec2-security-group.html",
});
```

## Not flagged

- **Non-literal values** — `allowed: SG_ALLOWED`. The contents are not statically knowable, so the rule leaves them alone.
- **Calls that spread another object** — skipped, to avoid false positives where the required field arrives via the spread.

## How it works

Syntactic. The rule keys on the `stringConstraint` callee name, which is unique to the constraint-catalogue mechanism.
