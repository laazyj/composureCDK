import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  type AwsCustomResourceProps,
} from "aws-cdk-lib/custom-resources";
import { type IConstruct } from "constructs";
import { Builder, COPY_STATE, type IBuilder, type Lifecycle, type Ref } from "@composurecdk/core";
import { AWS_CUSTOM_RESOURCE_DEFAULTS } from "./defaults.js";
import { resolveCall, type SdkCallConfig } from "./calls.js";
import { addDependenciesFromRefs } from "./dependencies.js";

/**
 * Passthrough configuration for the custom resource's provider Lambda and
 * CloudFormation resource — every {@link AwsCustomResourceProps} field **except**
 * the lifecycle calls and policy, which the builder configures through its
 * dedicated methods ({@link IAwsCustomResourceBuilder.onCreate | onCreate} /
 * {@link IAwsCustomResourceBuilder.allow | allow} /
 * {@link IAwsCustomResourceBuilder.policy | policy} /
 * {@link IAwsCustomResourceBuilder.dependsOn | dependsOn}).
 *
 * `installLatestAwsSdk` defaults to `false` (see {@link AWS_CUSTOM_RESOURCE_DEFAULTS});
 * set `role` to make the IAM policy optional.
 */
export type AwsCustomResourceBuilderProps = Omit<
  AwsCustomResourceProps,
  "onCreate" | "onUpdate" | "onDelete" | "policy"
>;

/**
 * The build output of an {@link IAwsCustomResourceBuilder}.
 */
export interface AwsCustomResourceBuilderResult {
  /**
   * The `AwsCustomResource` construct. Read-style response values are reached
   * through it, e.g.
   * `ref<AwsCustomResourceBuilderResult>("cr", r => r.customResource.getResponseField("Path"))`.
   */
  customResource: AwsCustomResource;
}

/**
 * A fluent, compose-native builder wrapping the CDK {@link AwsCustomResource}
 * construct for AWS operations that have **no CloudFormation resource** —
 * account-level SDK calls such as `ses:SetActiveReceiptRuleSet`, reachable only
 * through the SDK.
 *
 * **When a domain builder already covers the call you need, prefer it** — it
 * scopes IAM automatically and reads as intent rather than plumbing. This
 * builder is for the long tail of one-off SDK calls that don't justify a domain
 * builder.
 *
 * Benefits over raw `AwsCustomResource`:
 *
 * - **{@link dependsOn}** — a precise, declarative ordering seam. Tokens buried
 *   in `AwsCustomResource`'s JSON-stringified `parameters` frequently don't
 *   produce a CloudFormation dependency, so raw consumers hand-write
 *   `node.addDependency`. `dependsOn(ref(...))` wires the edge for exactly the
 *   component you name, even when parameters are hardcoded strings.
 * - **{@link SdkCallConfig.parameters | Resolvable parameters}** — calls can
 *   reference sibling `compose()` components via `ref` / `combine`.
 * - **{@link allow}** — IAM sugar over `AwsCustomResourcePolicy.fromStatements`.
 *
 * @example
 * ```ts
 * createAwsCustomResourceBuilder()
 *   .onUpdate({
 *     service: "SES",
 *     action: "setActiveReceiptRuleSet",
 *     parameters: ref<ReceiptRuleSetBuilderResult>("ruleSet").map((r) => ({
 *       RuleSetName: r.ruleSet.receiptRuleSetName,
 *     })),
 *     physicalResourceId: PhysicalResourceId.of("active-rule-set"),
 *   })
 *   .onDelete({ service: "SES", action: "setActiveReceiptRuleSet", parameters: {} })
 *   .dependsOn(ref<ReceiptRuleSetBuilderResult>("ruleSet"))
 *   .allow(["ses:SetActiveReceiptRuleSet"], ["*"]); // account-level action — * is visible
 * ```
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::CloudFormation::CustomResource has no Tags property
export type IAwsCustomResourceBuilder = IBuilder<
  AwsCustomResourceBuilderProps,
  AwsCustomResourceBuilder
>;

class AwsCustomResourceBuilder implements Lifecycle<AwsCustomResourceBuilderResult> {
  props: Partial<AwsCustomResourceBuilderProps> = {};
  #onCreate?: SdkCallConfig;
  #onUpdate?: SdkCallConfig;
  #onDelete?: SdkCallConfig;
  #policy?: AwsCustomResourcePolicy;
  readonly #statements: PolicyStatement[] = [];
  readonly #dependsOn: Ref<object>[] = [];

  /** The SDK call to run on resource creation. */
  onCreate(call: SdkCallConfig): this {
    this.#onCreate = call;
    return this;
  }

  /** The SDK call to run on resource update (also used for create if `onCreate` is unset). */
  onUpdate(call: SdkCallConfig): this {
    this.#onUpdate = call;
    return this;
  }

  /** The SDK call to run on resource deletion. Should undo the create/update. */
  onDelete(call: SdkCallConfig): this {
    this.#onDelete = call;
    return this;
  }

  /**
   * Grants the provider Lambda permission for `actions` on `resources`. Sugar
   * over `AwsCustomResourcePolicy.fromStatements`. `resources` is required — an
   * account-level action legitimately needs `["*"]`, but that broad grant
   * should be written explicitly so it is visible in review.
   */
  allow(actions: string[], resources: string[]): this {
    this.#statements.push(new PolicyStatement({ effect: Effect.ALLOW, actions, resources }));
    return this;
  }

  /**
   * Full-control escape for the provider Lambda's IAM policy — pass any
   * `AwsCustomResourcePolicy` (e.g. `fromSdkCalls`). Mutually exclusive with
   * {@link allow}.
   */
  policy(policy: AwsCustomResourcePolicy): this {
    this.#policy = policy;
    return this;
  }

  /**
   * Declares that this custom resource must be created after the named
   * component(s). The refs are resolved against the build context and a
   * CloudFormation `DependsOn` is added to each resolved construct — the
   * reliable ordering seam for calls whose parameters carry no token.
   */
  dependsOn(...refs: Ref<object>[]): this {
    this.#dependsOn.push(...refs);
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: AwsCustomResourceBuilder): void {
    target.#onCreate = this.#onCreate;
    target.#onUpdate = this.#onUpdate;
    target.#onDelete = this.#onDelete;
    target.#policy = this.#policy;
    target.#statements.push(...this.#statements);
    target.#dependsOn.push(...this.#dependsOn);
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): AwsCustomResourceBuilderResult {
    if (!this.#onCreate && !this.#onUpdate && !this.#onDelete) {
      throw new Error(
        `AwsCustomResourceBuilder "${id}": at least one of onCreate/onUpdate/onDelete must be configured.`,
      );
    }

    const policy = this.#resolvePolicy(id);
    const props: AwsCustomResourceProps = {
      ...AWS_CUSTOM_RESOURCE_DEFAULTS,
      ...this.props,
      ...(this.#onCreate ? { onCreate: resolveCall(this.#onCreate, context) } : {}),
      ...(this.#onUpdate ? { onUpdate: resolveCall(this.#onUpdate, context) } : {}),
      ...(this.#onDelete ? { onDelete: resolveCall(this.#onDelete, context) } : {}),
      ...(policy ? { policy } : {}),
    };

    const customResource = new AwsCustomResource(scope, id, props);
    addDependenciesFromRefs(customResource, this.#dependsOn, context);
    return { customResource };
  }

  #resolvePolicy(id: string): AwsCustomResourcePolicy | undefined {
    if (this.#policy && this.#statements.length > 0) {
      throw new Error(
        `AwsCustomResourceBuilder "${id}": use either .allow(...) or .policy(...), not both.`,
      );
    }
    if (this.#policy) return this.#policy;
    if (this.#statements.length > 0)
      return AwsCustomResourcePolicy.fromStatements(this.#statements);
    if (this.props.role) return undefined;
    throw new Error(
      `AwsCustomResourceBuilder "${id}": an IAM policy is required — call .allow(actions, resources), .policy(...), or supply a role.`,
    );
  }
}

/**
 * Creates a new {@link IAwsCustomResourceBuilder} — the compose-native escape
 * hatch wrapping {@link AwsCustomResource}. Prefer a domain builder when one
 * exists for the call you need.
 */
export function createAwsCustomResourceBuilder(): IAwsCustomResourceBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::CloudFormation::CustomResource has no Tags property
  return Builder<AwsCustomResourceBuilderProps, AwsCustomResourceBuilder>(AwsCustomResourceBuilder);
}
