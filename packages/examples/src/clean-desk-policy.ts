import { Aspects, CfnDeletionPolicy, PropertyInjectors, RemovalPolicy, Stack } from "aws-cdk-lib";
import type { IAspect, IPropertyInjector } from "aws-cdk-lib";
import { Bucket, CfnBucket, type BucketProps } from "aws-cdk-lib/aws-s3";
import { LogGroup, type LogGroupProps } from "aws-cdk-lib/aws-logs";
import { RestApi, type RestApiProps } from "aws-cdk-lib/aws-apigateway";
import {
  AwsCustomResource,
  AwsCustomResourcePolicy,
  PhysicalResourceId,
} from "aws-cdk-lib/custom-resources";
import { type IConstruct } from "constructs";

/**
 * A {@link IPropertyInjector} that overrides `removalPolicy` to
 * `RemovalPolicy.DESTROY` on a specific construct type.
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
 * A {@link IPropertyInjector} for S3 buckets that sets `removalPolicy` to
 * `DESTROY` and enables `autoDeleteObjects` so non-empty buckets can be
 * deleted. `autoDeleteObjects` must be set at construct creation time —
 * setting only `removalPolicy` via injection is not enough because the
 * builder's auto-delete logic runs before injection.
 */
class BucketRemovalPolicyInjector implements IPropertyInjector {
  readonly constructUniqueId = Bucket.PROPERTY_INJECTION_ID;

  inject(originalProps: BucketProps): BucketProps {
    return {
      ...originalProps,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    };
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
 * An {@link IAspect} that disables S3 server access logging on the source
 * bucket when the stack is deleted, so the destination logs bucket can be
 * emptied and deleted without racing against in-flight log deliveries.
 *
 * Without this, `autoDeleteObjects` empties the logs bucket once and then
 * CloudFormation calls `DeleteBucket` — and S3 server access log records
 * from the source bucket's own deletion activity arrive in between,
 * causing a 409 BucketNotEmpty on teardown.
 *
 * Disabling logging on the source (via `PutBucketLogging` with an empty
 * status) stops new records at the source before the logs bucket is torn
 * down. This Aspect runs during synth-prepare per ADR-0002 and only acts
 * on buckets whose deletion policy has been flipped to `Delete` — the
 * normal sandbox case.
 *
 * Scoped to stacks where the destination logs bucket is part of the same
 * construct tree. User-provided external log buckets are left alone.
 *
 * Not addressed: CloudFront standard logging. The distribution builder
 * already orders the distribution ahead of its logs bucket, and the
 * inherent CloudFront delete window (~15 min) reduces the race in
 * practice. A proper `UpdateDistribution(Logging={Enabled:false})` on
 * delete is deferred.
 */
const DISABLE_LOGGING_CR_ID = "CleanDeskDisableLogging";

class DisableSourceLoggingOnDeleteAspect implements IAspect {
  visit(node: IConstruct): void {
    if (!(node instanceof Bucket)) return;

    const cfn = node.node.defaultChild as CfnBucket | undefined;
    if (!cfn) return;
    if (cfn.cfnOptions.deletionPolicy !== CfnDeletionPolicy.DELETE) return;

    const logging = cfn.loggingConfiguration as CfnBucket.LoggingConfigurationProperty | undefined;
    if (!logging?.destinationBucketName) return;

    const logsBucket = resolveLogsBucketInStack(node, logging.destinationBucketName);
    if (!logsBucket) return;

    if (node.node.tryFindChild(DISABLE_LOGGING_CR_ID)) return;

    const disableLoggingCr = new AwsCustomResource(node, DISABLE_LOGGING_CR_ID, {
      resourceType: "Custom::DisableBucketLogging",
      onDelete: {
        service: "S3",
        action: "putBucketLogging",
        parameters: {
          Bucket: node.bucketName,
          BucketLoggingStatus: {},
        },
        physicalResourceId: PhysicalResourceId.of(`${node.node.addr}-disable-logging`),
        ignoreErrorCodesMatching: "NoSuchBucket",
      },
      policy: AwsCustomResourcePolicy.fromSdkCalls({ resources: [node.bucketArn] }),
      installLatestAwsSdk: false,
    });

    // Force CFN delete-order: disable logging BEFORE source.autoDelete empties
    // the source bucket (otherwise those DELETE calls emit access-log records
    // that arrive at the logs bucket after its own autoDelete has run).
    // CDK wires `autoDeleteObjects: true` as a child construct with id
    // "AutoDeleteObjectsCustomResource" — fragile if CDK renames it, but this
    // is sandbox-only and regressions surface at synth-time in the tests.
    const sourceAutoDelete = node.node.tryFindChild("AutoDeleteObjectsCustomResource");
    if (sourceAutoDelete) {
      disableLoggingCr.node.addDependency(sourceAutoDelete);
    }
  }
}

/**
 * Finds the in-stack {@link Bucket} that the given logging destination
 * `Ref` token resolves to. Returns `undefined` if the destination is
 * external or cannot be resolved (e.g. a supplied bucket name string).
 *
 * The `destinationBucketName` on `CfnBucket.LoggingConfigurationProperty`
 * is an intrinsic `Ref` when set via the L2 `serverAccessLogsBucket` prop,
 * so we compare against each candidate bucket's own resolved `Ref` token.
 */
function resolveLogsBucketInStack(
  source: Bucket,
  destinationBucketName: unknown,
): Bucket | undefined {
  const stack = Stack.of(source);
  const destinationToken = JSON.stringify(stack.resolve(destinationBucketName));

  for (const candidate of stack.node.findAll()) {
    if (!(candidate instanceof Bucket)) continue;
    if (candidate === source) continue;
    if (JSON.stringify(stack.resolve(candidate.bucketName)) === destinationToken) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Registers {@link IPropertyInjector}s that set removal policies to
 * `RemovalPolicy.DESTROY` on all stateful construct types used in the
 * example stacks, and an {@link IAspect} that disables S3 server access
 * logging on source buckets before they are torn down (so destination
 * logs buckets can be emptied and deleted without racing in-flight log
 * deliveries).
 *
 * This ensures that every stateful resource created under `scope` — S3
 * buckets, CloudWatch log groups, API Gateway accounts / CloudWatch roles,
 * and any resources they create internally — is cleaned up when the stack
 * is deleted.
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
  injectors.add(new BucketRemovalPolicyInjector());
  injectors.add(new RemovalPolicyInjector<LogGroupProps>(LogGroup.PROPERTY_INJECTION_ID));
  injectors.add(new RestApiRemovalPolicyInjector());

  Aspects.of(scope).add(new DisableSourceLoggingOnDeleteAspect());
}
