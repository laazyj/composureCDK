import { Annotations, Aws, Stack, Token } from "aws-cdk-lib";
import { Effect, PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { type LogGroup, ResourcePolicy } from "aws-cdk-lib/aws-logs";
import type { IConstruct } from "constructs";
import { createLogGroupBuilder, type ILogGroupBuilder } from "@composurecdk/logs";
import {
  QUERY_LOGGING_LOG_GROUP_NAME_PREFIX,
  QUERY_LOGGING_RESOURCE_POLICY_ID,
  QUERY_LOGGING_RESOURCE_POLICY_NAME,
} from "./defaults.js";

/**
 * Configures Route 53 public-hosted-zone DNS query logging. Pass `false` to
 * disable, or an object to either customize the auto-created CloudWatch
 * {@link LogGroup} sub-builder or to plug in a pre-existing log group ARN.
 *
 * `configure` cannot be combined with `logGroupArn` — the latter says
 * "I am bringing my own log group", which leaves nothing to configure.
 *
 * When auto-creating, the builder also materialises a single shared
 * `AWS::Logs::ResourcePolicy` per stack that grants the Route 53 service
 * principal write access to every log group under `/aws/route53/*`. This
 * sidesteps the 10-policy/region soft limit that the naive per-zone policy
 * approach would hit at four hosted zones.
 *
 * @see https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/query-logs.html
 * @see https://docs.aws.amazon.com/Route53/latest/APIReference/API_CreateQueryLoggingConfig.html
 */
export type QueryLoggingConfig =
  | false
  | {
      /**
       * Customize the auto-created LogGroup sub-builder. Receives a builder
       * pre-seeded with the `/aws/route53/<zoneName>` log-group name; the
       * well-architected retention/removal defaults from
       * {@link createLogGroupBuilder} are merged in at `build()` time and
       * are overridable by anything set on the builder here. Cannot be
       * combined with {@link logGroupArn}.
       */
      configure?: (b: ILogGroupBuilder) => ILogGroupBuilder;

      /**
       * Use a pre-existing log group instead of letting the builder create
       * one. The ARN must point at a log group in `us-east-1`, and the
       * caller is responsible for the `route53.amazonaws.com` resource
       * policy. Cannot be combined with {@link configure}.
       */
      logGroupArn?: string;
    };

const QUERY_LOGGING_REGION_ANNOTATION = "@composurecdk/route53:query-logging-region";
const QUERY_LOGGING_NAME_ANNOTATION = "@composurecdk/route53:query-logging-name";

interface ResolvedQueryLogging {
  /** The log group created for this hosted zone, or `undefined` when query logging is disabled or user-supplied. */
  queryLogGroup?: LogGroup;
  /** ARN to write into `PublicHostedZoneProps.queryLogsLogGroupArn`, or `undefined` when query logging is disabled. */
  queryLogsLogGroupArn?: string;
  /**
   * The shared `ResourcePolicy` covering this log group, or `undefined` when
   * query logging is disabled or the user supplied their own log group. The
   * caller wires the hosted zone's `DependsOn` against this so Route 53 does
   * not race the policy on first write.
   */
  policy?: ResourcePolicy;
}

/**
 * Resolve the query-logging configuration for a hosted zone build, creating
 * the auxiliary `LogGroup` and shared `ResourcePolicy` constructs as needed.
 *
 * @internal
 */
export function resolveQueryLogging(
  scope: IConstruct,
  id: string,
  zoneName: string,
  cfg: QueryLoggingConfig | undefined,
): ResolvedQueryLogging {
  if (cfg === false) return {};

  if (cfg?.logGroupArn !== undefined) {
    if (cfg.configure !== undefined) {
      throw new Error(
        `queryLogging: 'configure' cannot be combined with 'logGroupArn' — ` +
          `the log group is user-managed and not built by this builder.`,
      );
    }
    warnIfArnNotUsEast1(scope, cfg.logGroupArn);
    return { queryLogsLogGroupArn: cfg.logGroupArn };
  }

  errorIfStackNotUsEast1(scope);

  const defaultLogGroupName = `${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX}/${stripTrailingDot(zoneName)}`;
  let subBuilder: ILogGroupBuilder = createLogGroupBuilder().logGroupName(defaultLogGroupName);
  if (cfg?.configure) {
    subBuilder = cfg.configure(subBuilder);
  }

  const queryLogGroup = subBuilder.build(scope, `${id}QueryLogs`).logGroup;
  warnIfLogGroupNameOutsidePrefix(scope, id, subBuilder.logGroupName());

  return {
    queryLogGroup,
    queryLogsLogGroupArn: queryLogGroup.logGroupArn,
    policy: ensureSharedResourcePolicy(scope),
  };
}

function stripTrailingDot(name: string): string {
  return name.endsWith(".") ? name.slice(0, -1) : name;
}

function ensureSharedResourcePolicy(scope: IConstruct): ResourcePolicy {
  const stack = Stack.of(scope);
  const existing = stack.node.tryFindChild(QUERY_LOGGING_RESOURCE_POLICY_ID);
  if (existing instanceof ResourcePolicy) return existing;

  return new ResourcePolicy(stack, QUERY_LOGGING_RESOURCE_POLICY_ID, {
    resourcePolicyName: QUERY_LOGGING_RESOURCE_POLICY_NAME,
    policyStatements: [
      new PolicyStatement({
        sid: "AllowRoute53QueryLogging",
        effect: Effect.ALLOW,
        principals: [new ServicePrincipal("route53.amazonaws.com")],
        actions: ["logs:CreateLogStream", "logs:PutLogEvents"],
        resources: [
          `arn:${Aws.PARTITION}:logs:us-east-1:${Aws.ACCOUNT_ID}:log-group:${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX}/*:*`,
        ],
        conditions: {
          StringEquals: { "aws:SourceAccount": Aws.ACCOUNT_ID },
        },
      }),
    ],
  });
}

function errorIfStackNotUsEast1(scope: IConstruct): void {
  const region = Stack.of(scope).region;
  if (Token.isUnresolved(region)) return;
  if (region === "us-east-1") return;
  throw new Error(
    `Route 53 accepts DNS query logs only in us-east-1, but this stack is deployed in "${region}". ` +
      `Either:\n` +
      `  1. Deploy the stack containing this hosted zone in us-east-1, or\n` +
      `  2. Pass queryLogging({ logGroupArn: 'arn:aws:logs:us-east-1:...' }) referencing a log group ` +
      `you own in us-east-1, or\n` +
      `  3. Set queryLogging(false) to opt out.`,
  );
}

function warnIfArnNotUsEast1(scope: IConstruct, arn: string): void {
  if (Token.isUnresolved(arn)) return;
  const region = parseLogGroupArnRegion(arn);
  if (region === undefined || region === "us-east-1") return;
  Annotations.of(scope).addWarningV2(
    QUERY_LOGGING_REGION_ANNOTATION,
    `queryLogging.logGroupArn references a log group in "${region}", but Route 53 query logs ` +
      `are accepted only in us-east-1. The deploy will fail unless this ARN is corrected.`,
  );
}

function warnIfLogGroupNameOutsidePrefix(
  scope: IConstruct,
  id: string,
  logGroupName: string | undefined,
): void {
  if (logGroupName === undefined || Token.isUnresolved(logGroupName)) return;
  if (logGroupName.startsWith(`${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX}/`)) return;
  Annotations.of(scope).addWarningV2(
    QUERY_LOGGING_NAME_ANNOTATION,
    `Hosted zone "${id}" query log group is named "${logGroupName}", which is outside the ` +
      `"${QUERY_LOGGING_LOG_GROUP_NAME_PREFIX}/*" prefix that the auto-managed resource policy ` +
      `covers. Add a resource policy on this log group granting route53.amazonaws.com permission ` +
      `to logs:CreateLogStream and logs:PutLogEvents, or change the name back to the default prefix.`,
  );
}

function parseLogGroupArnRegion(arn: string): string | undefined {
  // arn:partition:logs:region:account:log-group:name
  const parts = arn.split(":");
  if (parts.length < 6 || parts[0] !== "arn" || parts[2] !== "logs") return undefined;
  return parts[3];
}
