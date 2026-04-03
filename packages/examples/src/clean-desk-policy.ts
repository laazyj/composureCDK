import { PropertyInjectors, RemovalPolicy } from "aws-cdk-lib";
import type { IPropertyInjector } from "aws-cdk-lib";
import { Bucket, type BucketProps } from "aws-cdk-lib/aws-s3";
import { LogGroup, type LogGroupProps } from "aws-cdk-lib/aws-logs";
import { RestApi, type RestApiProps } from "aws-cdk-lib/aws-apigateway";
import { type IConstruct } from "constructs";

/**
 * A {@link IPropertyInjector} that overrides `removalPolicy` to
 * `RemovalPolicy.DESTROY` on a specific construct type.
 *
 * Works at the CDK props level — injected *before* construct creation —
 * so builder-level logic that depends on the removal policy (e.g. the
 * S3 builder's automatic `autoDeleteObjects`) sees the overridden value
 * and responds correctly.
 */
class RemovalPolicyInjector<
  Props extends { removalPolicy?: RemovalPolicy },
> implements IPropertyInjector {
  readonly constructUniqueId: string;

  constructor(constructUniqueId: string) {
    this.constructUniqueId = constructUniqueId;
  }

  inject(originalProps: Props): Props {
    return { ...originalProps, removalPolicy: RemovalPolicy.DESTROY };
  }
}

/**
 * A {@link IPropertyInjector} that overrides `cloudWatchRoleRemovalPolicy`
 * to `RemovalPolicy.DESTROY` on a RestApi. The CDK RestApi uses a separate
 * prop for the Account / CloudWatch Role resources it creates internally.
 */
class RestApiRemovalPolicyInjector implements IPropertyInjector {
  readonly constructUniqueId = RestApi.PROPERTY_INJECTION_ID;

  inject(originalProps: RestApiProps): RestApiProps {
    return { ...originalProps, cloudWatchRoleRemovalPolicy: RemovalPolicy.DESTROY };
  }
}

/**
 * Registers {@link IPropertyInjector}s that set removal policies to
 * `RemovalPolicy.DESTROY` on all stateful construct types used in the
 * example stacks.
 *
 * This ensures that every stateful resource created under `scope` — S3
 * buckets, CloudWatch log groups, API Gateway accounts / CloudWatch roles,
 * and any resources they create internally — is cleaned up when the stack
 * is deleted.
 *
 * Because PropertyInjectors run *before* construct creation, builder-level
 * logic that reacts to the removal policy (e.g. the S3 builder's automatic
 * `autoDeleteObjects`) works correctly.
 *
 * Intended for development, testing, and example stacks where orphaned
 * resources are undesirable. **Do not use in production.**
 *
 * Covered construct types:
 * - `aws-cdk-lib/aws-s3.Bucket`
 * - `aws-cdk-lib/aws-logs.LogGroup`
 * - `aws-cdk-lib/aws-apigateway.RestApi` (Account + CloudWatch Role)
 *
 * If new stateful construct types are added to example stacks (e.g.
 * DynamoDB tables, SQS queues), add a corresponding injector here.
 *
 * @param scope - The scope to apply the policy to (typically an `App`).
 */
export function cleanDeskPolicy(scope: IConstruct): void {
  const injectors = PropertyInjectors.of(scope);
  injectors.add(new RemovalPolicyInjector<BucketProps>(Bucket.PROPERTY_INJECTION_ID));
  injectors.add(new RemovalPolicyInjector<LogGroupProps>(LogGroup.PROPERTY_INJECTION_ID));
  injectors.add(new RestApiRemovalPolicyInjector());
}
