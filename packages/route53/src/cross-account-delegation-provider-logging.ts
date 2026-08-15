import { Annotations, CfnResource, Stack, Token } from "aws-cdk-lib";
import { CfnFunction } from "aws-cdk-lib/aws-lambda";
import { LogGroup } from "aws-cdk-lib/aws-logs";
import type { IConstruct } from "constructs";
import { createLogGroupBuilder, type ILogGroupBuilder } from "@composurecdk/logs";
import {
  DELEGATION_PROVIDER_LOG_GROUP_ID,
  DELEGATION_PROVIDER_LOG_GROUP_NAME_PREFIX,
} from "./defaults.js";

/**
 * Configures the CloudWatch log group for the Lambda-backed
 * `Custom::CrossAccountZoneDelegation` provider that
 * {@link createCrossAccountZoneDelegationBuilder} relies on. Pass `false` to
 * leave the provider's logging alone, or an object to customize the
 * auto-created {@link LogGroup} sub-builder.
 *
 * aws-cdk-lib creates the provider as a raw `AWS::Lambda::Function` with no
 * `LoggingConfig`, so without this the Lambda service implicitly creates
 * `/aws/lambda/<generated-name>` on first invocation with **indefinite**
 * retention — a log group no template describes, no lifecycle policy governs,
 * and no `@composurecdk/logs` default reaches. Opting in gives the provider a
 * declared log group carrying this library's retention/removal defaults, the
 * same treatment the hosted zone's query-log group already gets.
 *
 * @see https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-properties-lambda-function-loggingconfig.html
 */
export type DelegationProviderLoggingConfig =
  | false
  | {
      /**
       * Customize the auto-created LogGroup sub-builder. Receives a builder
       * pre-seeded with the `/aws/lambda/<stackName>-cross-account-zone-delegation`
       * log-group name; the retention/removal defaults from
       * {@link createLogGroupBuilder} are merged in at `build()` time and are
       * overridable by anything set here.
       *
       * Keep the name under the `/aws/lambda/` prefix. The provider's
       * execution role is CDK's own, carrying only the
       * `AWSLambdaBasicExecutionRole` managed policy, which permits
       * `logs:PutLogEvents` on `/aws/lambda/*` and nothing else — a log group
       * named outside that prefix silently receives no logs.
       */
      configure?: (b: ILogGroupBuilder) => ILogGroupBuilder;
    };

/**
 * Construct id CDK gives the singleton provider inside the stack, and the id
 * of the raw `AWS::Lambda::Function` beneath it. Both are aws-cdk-lib
 * internals rather than public API, so every read of them is defensive: a
 * miss annotates rather than throws, leaving the delegation record itself
 * working on CDK versions that rename them.
 */
const PROVIDER_RESOURCE_TYPE = "Custom::CrossAccountZoneDelegation";
const PROVIDER_CONSTRUCT_ID = `${PROVIDER_RESOURCE_TYPE}CustomResourceProvider`;
const PROVIDER_HANDLER_CONSTRUCT_ID = "Handler";

/** Warning id emitted when the provider's Lambda cannot be located. */
const DELEGATION_PROVIDER_HANDLER_ANNOTATION = "@composurecdk/route53:delegation-provider-handler";

/** Warning id emitted when a customized log group falls outside `/aws/lambda/`. */
const DELEGATION_PROVIDER_LOG_GROUP_NAME_ANNOTATION =
  "@composurecdk/route53:delegation-provider-log-group-name";

/** Warning id emitted when a later record's `providerLogging` could not be honoured. */
const DELEGATION_PROVIDER_LOGGING_CONFLICT_ANNOTATION =
  "@composurecdk/route53:delegation-provider-logging-conflict";

/**
 * Give the stack's `Custom::CrossAccountZoneDelegation` provider Lambda a
 * declared log group with the `@composurecdk/logs` defaults.
 *
 * The provider is a **stack-level singleton** (CDK's `getOrCreateProvider`),
 * so the log group is too: the first delegation record in the stack settles it
 * and every later record is handed the same one. That makes `providerLogging` a
 * per-record knob over a shared resource, so the dedup check comes first and a
 * later record whose setting could not be honoured is told so rather than
 * silently ignored. Call only after the
 * {@link CrossAccountZoneDelegationRecord} has been constructed — that is what
 * materialises the provider.
 *
 * @internal
 */
export function applyDelegationProviderLogging(
  scope: IConstruct,
  cfg: DelegationProviderLoggingConfig | undefined,
): LogGroup | undefined {
  const stack = Stack.of(scope);

  // Ahead of the `false` check: an earlier record in this stack has already
  // settled the singleton, and this record cannot unsettle it. Returning the
  // group it will actually log to beats returning `undefined` and implying an
  // isolation that does not exist.
  const existing = stack.node.tryFindChild(DELEGATION_PROVIDER_LOG_GROUP_ID);
  if (existing instanceof LogGroup) {
    warnIfSettingIgnored(scope, cfg, existing);
    return existing;
  }

  if (cfg === false) return undefined;

  const handler = findProviderHandler(stack);
  if (!handler) {
    Annotations.of(scope).addWarningV2(
      DELEGATION_PROVIDER_HANDLER_ANNOTATION,
      `Could not find the "${PROVIDER_RESOURCE_TYPE}" provider Lambda in this stack, so its log ` +
        `group is left to the Lambda service — created on first invocation with indefinite ` +
        `retention and absent from the template. This means aws-cdk-lib has changed where it ` +
        `puts the provider; the delegation record itself is unaffected. Set ` +
        `.providerLogging(false) to silence this warning.`,
    );
    return undefined;
  }

  const defaultName = `${DELEGATION_PROVIDER_LOG_GROUP_NAME_PREFIX}/${stack.stackName}-cross-account-zone-delegation`;
  let subBuilder: ILogGroupBuilder = createLogGroupBuilder().logGroupName(defaultName);
  if (cfg?.configure) {
    subBuilder = cfg.configure(subBuilder);
  }

  const logGroup = subBuilder.build(stack, DELEGATION_PROVIDER_LOG_GROUP_ID).logGroup;
  warnIfNameOutsideLambdaPrefix(scope, subBuilder.logGroupName());

  handler.addPropertyOverride("LoggingConfig", { LogGroup: logGroup.logGroupName });
  // The Lambda cannot be created pointing at a log group that does not exist yet.
  handler.node.addDependency(logGroup);

  return logGroup;
}

/**
 * Locate the provider's `AWS::Lambda::Function` L1 in the construct tree.
 *
 * `CustomResourceProviderBase` keeps its handler private, so the L1 is reached
 * by construct path and identified by `cfnResourceType` — the jsii-safe idiom
 * ADR-0011 sanctions for reading an L1 across bundled CDK realms, where
 * `instanceof` is unreliable.
 */
function findProviderHandler(stack: Stack): CfnResource | undefined {
  const provider = stack.node.tryFindChild(PROVIDER_CONSTRUCT_ID);
  const handler = provider?.node.tryFindChild(PROVIDER_HANDLER_CONSTRUCT_ID);
  if (!CfnResource.isCfnResource(handler)) return undefined;
  return handler.cfnResourceType === CfnFunction.CFN_RESOURCE_TYPE_NAME ? handler : undefined;
}

/**
 * Tell a later delegation record that its `providerLogging` had no effect,
 * because an earlier record in the same stack already settled the singleton.
 * Silence would leave the outcome depending on `compose`'s build order with no
 * signal at all; a warning is right rather than a throw because the common case
 * — several records all on the default — is not a mistake.
 */
function warnIfSettingIgnored(
  scope: IConstruct,
  cfg: DelegationProviderLoggingConfig | undefined,
  existing: LogGroup,
): void {
  const setting = cfg === false ? ".providerLogging(false)" : "a providerLogging 'configure'";
  if (cfg !== false && !cfg?.configure) return;
  Annotations.of(scope).addWarningV2(
    DELEGATION_PROVIDER_LOGGING_CONFLICT_ANNOTATION,
    `This delegation record sets ${setting}, but the "${PROVIDER_RESOURCE_TYPE}" provider is a ` +
      `stack-level singleton and an earlier record in this stack already settled its log group ` +
      `("${existing.node.id}"). The setting has no effect and this record will log to that group. ` +
      `Configure provider logging on one record per stack.`,
  );
}

function warnIfNameOutsideLambdaPrefix(scope: IConstruct, logGroupName: string | undefined): void {
  if (logGroupName === undefined || Token.isUnresolved(logGroupName)) return;
  if (logGroupName.startsWith(`${DELEGATION_PROVIDER_LOG_GROUP_NAME_PREFIX}/`)) return;
  Annotations.of(scope).addWarningV2(
    DELEGATION_PROVIDER_LOG_GROUP_NAME_ANNOTATION,
    `The cross-account delegation provider's log group is named "${logGroupName}", which is ` +
      `outside the "${DELEGATION_PROVIDER_LOG_GROUP_NAME_PREFIX}/*" prefix that the provider's ` +
      `AWSLambdaBasicExecutionRole permits it to write to. The provider will run but emit no ` +
      `logs. Rename it back under "${DELEGATION_PROVIDER_LOG_GROUP_NAME_PREFIX}/".`,
  );
}
