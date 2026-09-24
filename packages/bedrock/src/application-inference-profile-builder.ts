import {
  CfnApplicationInferenceProfile,
  type CfnApplicationInferenceProfileProps,
} from "aws-cdk-lib/aws-bedrock";
import type { IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import type { ApplicationInferenceProfile } from "./inference-profile.js";
import { sourceArn } from "./inference-target.js";

/** Configuration properties for {@link createApplicationInferenceProfileBuilder}. */
export interface ApplicationInferenceProfileBuilderProps extends Omit<
  CfnApplicationInferenceProfileProps,
  "modelSource" | "tags"
> {
  /** The foundation model or system-defined profile to route to. Required. */
  source: Resolvable<ApplicationInferenceProfile["source"]>;
}

/** The build output of an {@link IApplicationInferenceProfileBuilder}. */
export interface ApplicationInferenceProfileBuilderResult {
  applicationInferenceProfile: CfnApplicationInferenceProfile;
  /** The profile as an invocation target, for grants and callers. */
  profile: ApplicationInferenceProfile;
}

/**
 * A fluent builder for an Amazon Bedrock application inference profile.
 *
 * @see {@link createApplicationInferenceProfileBuilder}
 */
export type IApplicationInferenceProfileBuilder = ITaggedBuilder<
  ApplicationInferenceProfileBuilderProps,
  ApplicationInferenceProfileBuilder
>;

class ApplicationInferenceProfileBuilder implements Lifecycle<ApplicationInferenceProfileBuilderResult> {
  props: Partial<ApplicationInferenceProfileBuilderProps> = {};

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): ApplicationInferenceProfileBuilderResult {
    const { source: sourceRef, inferenceProfileName, ...rest } = this.props;
    if (!inferenceProfileName || sourceRef === undefined) {
      throw new Error(
        `ApplicationInferenceProfileBuilder "${id}" requires an inferenceProfileName and a ` +
          `source. Call .inferenceProfileName() and .source().`,
      );
    }
    const source = resolve(sourceRef, context);
    const applicationInferenceProfile = new CfnApplicationInferenceProfile(scope, id, {
      ...rest,
      inferenceProfileName,
      modelSource: { copyFrom: sourceArn(source, scope) },
    });
    return {
      applicationInferenceProfile,
      profile: {
        kind: "application",
        profileArn: applicationInferenceProfile.attrInferenceProfileArn,
        profileId: applicationInferenceProfile.attrInferenceProfileId,
        source,
      },
    };
  }
}

/**
 * Creates a builder for an {@link ApplicationInferenceProfile}, which carries
 * the builder's tags. Pass the result's `profile` to `modelGrants.invoke`, and
 * its `profileArn` to callers as the model id.
 *
 * @example
 * ```ts
 * createApplicationInferenceProfileBuilder()
 *   .inferenceProfileName("support-assistant")
 *   .source(haiku)
 *   .tag("CostCentre", "support");
 * ```
 *
 * @see https://docs.aws.amazon.com/bedrock/latest/userguide/inference-profiles-create.html
 */
export function createApplicationInferenceProfileBuilder(): IApplicationInferenceProfileBuilder {
  return taggedBuilder<ApplicationInferenceProfileBuilderProps, ApplicationInferenceProfileBuilder>(
    ApplicationInferenceProfileBuilder,
  );
}
