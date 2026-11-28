# Auditing an existing ComposureCDK app

Before you upgrade, refactor or review a whole app built with ComposureCDK, audit it against the [agent rules](agent-rules.md). Many such apps predate the rules, and the audit tells you which changes are worth making and which would replace deployed resources. It is read-only: report, and change nothing until you are asked to.

## What to read

Read the [agent rules](agent-rules.md) and the [review rubric](review-rubric.md) beside them. Then read the app's whole infrastructure codebase, not a diff:

- every `compose()` declaration, in full, with its dependency map;
- the configuration, app, stack and system layers, and where each concern sits;
- custom builders and inline `Lifecycle` objects;
- grants, defaults that are overridden or switched off, and alarms;
- the infrastructure tests.

Record the app's ComposureCDK version. A rule that names an API the app's version lacks is "needs upgrade", not a breach.

## What to check

Go through every rule in the agent rules, not only the rubric's checks. For each rule, decide whether it applies to this app, and if it does, look for breaches. Use the rubric's [severities](review-rubric.md#severity), as it applies them to an audit.

## What to report

One row per breach, most severe first:

| Field         | What it holds                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Rule          | The rule ID.                                                                                                                                                             |
| Where         | File and line.                                                                                                                                                           |
| Evidence      | What the code does, in one or two sentences.                                                                                                                             |
| Severity      | Blocking, should fix or consider, as the rubric defines them.                                                                                                            |
| Risk if left  | What goes wrong, and when: the next deploy, a rename, an incident, the next change.                                                                                      |
| Change        | The fix, in one sentence.                                                                                                                                                |
| Effort        | S (under an hour), M (under a day) or L (more).                                                                                                                          |
| Deploy impact | None, in-place update, resource replacement, or needs a migration. Say how you know: synthesize the app with and without the change and diff the templates (PATH-2).     |
| Verdict       | "Fix now", "fix when next touched", "leave", "needs library change" or "rule doesn't fit", with one sentence weighing the risk against the effort and the deploy impact. |
| Confidence    | High, medium or low.                                                                                                                                                     |

Use "needs library change" when the rule fits but ComposureCDK blocks the fix, and "rule doesn't fit" when following the rule here would make the app worse, saying why.

Then report, separately:

1. The rules that don't apply, each with a one-line reason, and the rules the app follows with no breach.
2. Problems no rule covers: what, where, and the rule you would write.
3. Rules whose wording made a finding ambiguous, and what was unclear.
4. Anything that needs a newer ComposureCDK version.

## Before changing anything

A change that looks like tidying can change construct paths and replace deployed resources: check it against PATH-1 to PATH-3, and prove it with a template diff, before calling it safe.

## Feedback on the rules

When a rule doesn't fit, is missing or is unclear, say so with the [Guide feedback template](https://github.com/laazyj/composureCDK/issues/new?template=guide_feedback.md). When the fix belongs in ComposureCDK, [open a feature request](https://github.com/laazyj/composureCDK/issues/new?template=feature_request.md).
