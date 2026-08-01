import { Annotations, Aspects, CfnElement, CfnResource, Stack, Token } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import {
  describeOffenders,
  sanitizeTemplateText,
  templateTextMessage,
  transliterate,
} from "../constraints/template-text.js";
import { TEMPLATE_TEXT_FIELDS, type TemplateTextFields } from "./template-text-fields.js";

/**
 * Merges consumer-supplied fields over the built-in registry, unioning the
 * property list for a resource type present in both. A `Map` rather than an
 * object so a lookup miss is `undefined` in the type system as well as at
 * runtime, which a `Record`'s index signature does not express.
 */
function mergeFields(
  extra: TemplateTextFields | undefined,
): ReadonlyMap<string, readonly string[]> {
  const merged = new Map<string, readonly string[]>(Object.entries(TEMPLATE_TEXT_FIELDS));
  for (const [type, properties] of Object.entries(extra ?? {})) {
    merged.set(type, [...new Set([...(merged.get(type) ?? []), ...properties])]);
  }
  return merged;
}

/**
 * The warning id `warn` mode annotates with, where the running `aws-cdk-lib`
 * supports acknowledgeable warnings. Pass it to
 * `Annotations.of(scope).acknowledgeWarning(...)` to silence a known case.
 */
export const TEMPLATE_TEXT_WARNING_NAME = "composurecdk:templateText";

interface WarningAnnotations {
  addWarningV2?: (id: string, message: string) => void;
  addWarning: (message: string) => void;
}

/**
 * Emits an acknowledgeable warning where the runtime has one.
 *
 * `Annotations.addWarningV2` only exists from aws-cdk-lib 2.93.0, and this
 * package's declared floor is 2.1.0 — the lowest in the repo, because every
 * other package peer-depends on it (ADR-0008). Raising the floor for one
 * optional mode would drag the whole library up with it, so this degrades to
 * the 2.0-era `addWarning` instead. Same version-portability reasoning as the
 * `isCfnAlarm` shim in `@composurecdk/cloudwatch`.
 */
function warn(node: IConstruct, message: string): void {
  const annotations = Annotations.of(node) as unknown as WarningAnnotations;
  if (typeof annotations.addWarningV2 === "function") {
    annotations.addWarningV2(TEMPLATE_TEXT_WARNING_NAME, message);
    return;
  }
  annotations.addWarning(message);
}

/**
 * What the policy does with a value CloudFormation would transliterate.
 *
 * - `throw` — fail synth at the first violation, naming the construct path,
 *   the field and the offending character.
 * - `sanitize` — rewrite the value in place so the synthesised template
 *   matches what CloudFormation will store. Nothing fails.
 * - `warn` — annotate every violation and carry on. The diff stays, but the
 *   whole list is visible in one pass, which is how to adopt `throw` on an
 *   existing estate: run `warn`, fix the list, then switch.
 */
export type TemplateTextViolationMode = "throw" | "sanitize" | "warn";

/** Configuration for {@link templateTextPolicy}. */
export interface TemplateTextPolicyConfig {
  /**
   * How to handle a violation.
   * @default "throw"
   */
  onViolation?: TemplateTextViolationMode;

  /**
   * Maps one disallowed character to its ASCII stand-in, in `sanitize` mode.
   * @default transliterate - common typographic characters, then `?`
   */
  replace?: (char: string) => string;

  /**
   * Extra free-text properties to check, keyed by CloudFormation resource type
   * with CDK L1 (camelCase) property names. Merged over the built-in registry.
   *
   * @example
   * ```ts
   * { fields: { "AWS::Custom::Widget": ["notes"] } }
   * ```
   */
  fields?: TemplateTextFields;
}

/**
 * The checkable fields on one node: the object holding them, their keys, and a
 * qualifier that names the kind in a diagnostic. The label itself is composed
 * only on a violation — `node.path` walks and joins the ancestor chain on every
 * access, which is far too expensive to pay for every field of every construct.
 */
interface FieldSet {
  readonly target: Record<string, unknown>;
  readonly properties: readonly string[];
  readonly qualifier: string;
}

const DESCRIPTION: readonly string[] = ["description"];

/**
 * Narrows a raw property value to the concrete string CloudFormation will
 * store, or `undefined` when there is nothing to check.
 *
 * A token-free string is returned as-is: `resolve()` builds a resolution
 * context and scans for token fragments, which is the most expensive step in
 * the visit and pure waste on a plain literal. Everything else is resolved,
 * because an L1 property is often `Lazy`-wrapped even when plainly set. A
 * `Lazy` producing a string is deliberately *not* skipped — that string is what
 * deploys, so it is exactly what to check. What is skipped is a value that
 * resolves to a CloudFormation intrinsic (a `Ref`, an `Fn::ImportValue`), which
 * resolves to an object rather than a string and whose text is not knowable at
 * synth (ADR-0010).
 */
function concrete(node: IConstruct, value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (!Token.isUnresolved(value)) return value;
  const resolved: unknown = Stack.of(node).resolve(value);
  if (typeof resolved !== "string" || Token.isUnresolved(resolved)) return undefined;
  return resolved;
}

/**
 * The fields on `node` worth checking, or `undefined` for the great majority of
 * constructs that carry no template text. Three node kinds carry it and only
 * one is a `CfnResource`, so the registry alone is not enough — see ADR-0017 §7.
 */
function fieldsOf(
  node: IConstruct,
  registry: ReadonlyMap<string, readonly string[]>,
): FieldSet | undefined {
  if (Stack.isStack(node)) {
    return {
      target: node.templateOptions as unknown as Record<string, unknown>,
      properties: DESCRIPTION,
      qualifier: "template ",
    };
  }

  const target = node as unknown as Record<string, unknown>;

  if (CfnResource.isCfnResource(node)) {
    const properties = registry.get(node.cfnResourceType);
    if (properties === undefined || properties.length === 0) return undefined;
    return { target, properties, qualifier: `${node.cfnResourceType} ` };
  }

  // A non-resource CfnElement with a string `description` is a CfnOutput or
  // CfnParameter; the other element kinds (mappings, conditions, rules) have
  // no free-text property, so duck-typing costs nothing and stays portable.
  if (CfnElement.isCfnElement(node) && typeof target.description === "string") {
    return { target, properties: DESCRIPTION, qualifier: "" };
  }

  return undefined;
}

/**
 * Fails synth — or quietly repairs the template — when a value CloudFormation
 * cannot store verbatim reaches a free-text field.
 *
 * CloudFormation stores template text as ASCII, silently transliterating
 * anything else (an em-dash, a curly quote) to `?` at deploy time. There is no
 * error: the deployed template simply stops matching the synthesised one, and
 * `cdk diff` reports a change on every run afterwards, forever, on a stack
 * nobody touched.
 *
 * Installs a CDK
 * {@link https://docs.aws.amazon.com/cdk/v2/guide/aspects.html | Aspect}, so it
 * sees the whole subtree at synth time — including raw L1 constructs, L2s from
 * other libraries, and fields no builder validates. Call it once on any scope
 * before `app.synth()`; constructs added afterwards are still covered, so
 * ordering does not matter.
 *
 * Coverage is deliberately partial — values resolving to a CloudFormation
 * intrinsic, values written via `addPropertyOverride`, nested property paths,
 * and unregistered resource types are all outside it. The package README lists
 * the gaps in full and ADR-0017 records why the policy is opt-in rather than
 * enforced at every builder.
 *
 * @param scope - Any construct; the policy applies to its whole subtree.
 * @param config - Mode, replacement function, and extra fields.
 *
 * @example
 * ```ts
 * // Fail synth on anything CloudFormation would rewrite.
 * templateTextPolicy(app);
 *
 * // Or repair it, so the template matches what gets deployed.
 * templateTextPolicy(app, { onViolation: "sanitize" });
 *
 * // Adopting on an existing estate: list everything first.
 * templateTextPolicy(app, { onViolation: "warn" });
 * ```
 */
export function templateTextPolicy(scope: IConstruct, config: TemplateTextPolicyConfig = {}): void {
  const { onViolation = "throw", replace = transliterate } = config;
  const registry = mergeFields(config.fields);

  Aspects.of(scope).add({
    visit(node: IConstruct): void {
      const fields = fieldsOf(node, registry);
      if (fields === undefined) return;
      const { target, properties, qualifier } = fields;

      for (const property of properties) {
        const value = concrete(node, target[property]);
        if (value === undefined) continue;

        if (onViolation === "sanitize") {
          const cleaned = sanitizeTemplateText(value, replace);
          // Only write on a change: assigning back would freeze a clean `Lazy`
          // into the literal it happened to produce at visit time.
          if (cleaned !== value) target[property] = cleaned;
          continue;
        }

        const offenders = describeOffenders(value);
        if (offenders === undefined) continue;

        const label = `${node.node.path || node.node.id}: ${qualifier}${property}`;
        const message = templateTextMessage(label, offenders);
        // `Annotations.addError` would report every violation in one pass, but
        // only the CDK CLI acts on error metadata — `app.synth()` and
        // `Template.fromStack()` would sail past it. Throwing fails everywhere,
        // and matches how the rest of the constraint catalogue reports (ADR-0010).
        if (onViolation === "throw") throw new Error(message);
        warn(node, message);
      }
    },
  });
}
