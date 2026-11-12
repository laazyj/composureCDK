import { ArnFormat, Token } from "aws-cdk-lib";
import type { LogGroup } from "aws-cdk-lib/aws-logs";
import {
  CfnLoggingConfiguration,
  type CfnLoggingConfigurationProps,
  type CfnWebACL,
} from "aws-cdk-lib/aws-wafv2";
import type { IConstruct } from "constructs";
import { resolve, type Resolvable } from "@composurecdk/core";
import { createLogGroupBuilder, type ILogGroupBuilder } from "@composurecdk/logs";
import {
  DEFAULT_LOGGING_FILTER,
  DEFAULT_LOGGING_REDACTED_HEADERS,
  WAF_LOG_GROUP_NAME_PREFIX,
} from "./defaults.js";
import { toFilterProperty, type WebAclLoggingFilter } from "./logging-filter.js";
import { webAclBaseName } from "./names.js";
import type { WebAclBuilderResult } from "./web-acl-builder.js";

/** Request fields to redact from the log. */
export interface WebAclLogRedaction {
  /**
   * Header names to redact, **in addition to** `authorization` and `cookie`,
   * which are always redacted.
   */
  readonly headers?: readonly string[];
  /** Redact the query string. */
  readonly queryString?: boolean;
  /** Redact the URI path. */
  readonly uriPath?: boolean;
  /** Redact the HTTP method. */
  readonly method?: boolean;
}

/**
 * Configures the web ACL's logging. On by default: WAF writes the requests it
 * does not allow to a created `aws-waf-logs-` CloudWatch log group, with the
 * `authorization` and `cookie` headers redacted. `false` turns it off.
 */
export interface WebAclLoggingConfig {
  /**
   * Customize the created log group. It starts with an `aws-waf-logs-` name,
   * which WAF requires, and the `@composurecdk/logs` retention and removal
   * defaults. The callback's builder resolves `ref`s against the build
   * context. Cannot be combined with {@link destination}.
   */
  readonly configure?: (b: ILogGroupBuilder) => ILogGroupBuilder;

  /**
   * Log to an existing destination instead of a created log group: a
   * CloudWatch log group, S3 bucket or Firehose stream ARN, or a reference
   * CDK's `CfnLoggingConfiguration` accepts. Its name must start with
   * `aws-waf-logs-`, a log group ARN must not end in `:*`, an S3 bucket must
   * use SSE-S3 or a customer managed key, and a Firehose stream must be
   * DirectPut. Cannot be combined with {@link configure}.
   */
  readonly destination?: Resolvable<
    NonNullable<CfnLoggingConfigurationProps["logDestinationConfigs"]>[number]
  >;

  /**
   * Which requests to log. `"non-allow"`, the default, keeps every request
   * WAF blocks, counts, or answers with a CAPTCHA or challenge, and drops the
   * rest. `"all"` keeps everything.
   */
  readonly filter?: "non-allow" | "all" | WebAclLoggingFilter;

  /** Fields to redact, merged with the defaults. */
  readonly redact?: WebAclLogRedaction;
}

const MAX_REDACTED_FIELDS = 100;
const LOGGING_SOURCE = "https://docs.aws.amazon.com/waf/latest/developerguide/logging.html";

function loggingFilter(filter: WebAclLoggingConfig["filter"]): unknown {
  if (filter === "all") return undefined;
  return toFilterProperty(typeof filter === "object" ? filter : DEFAULT_LOGGING_FILTER);
}

function redactedFields(
  owner: string,
  redact: WebAclLogRedaction | undefined,
): CfnLoggingConfiguration.FieldToMatchProperty[] {
  const headers = new Map<string, string>();
  for (const name of [...DEFAULT_LOGGING_REDACTED_HEADERS, ...(redact?.headers ?? [])]) {
    headers.set(name.toLowerCase(), name);
  }
  // `FieldToMatch`'s members are `any` in CDK, so `SingleHeader` needs CloudFormation's `Name`.
  const fields: CfnLoggingConfiguration.FieldToMatchProperty[] = [...headers.values()].map(
    (Name) => ({ singleHeader: { Name } }),
  );
  if (redact?.queryString) fields.push({ queryString: {} });
  if (redact?.uriPath) fields.push({ uriPath: {} });
  if (redact?.method) fields.push({ method: {} });
  if (fields.length > MAX_REDACTED_FIELDS) {
    throw new Error(
      `${owner}: logging redacts ${String(fields.length)} fields; AWS WAF allows at most ${String(MAX_REDACTED_FIELDS)}. See ${LOGGING_SOURCE}.`,
    );
  }
  return fields;
}

function checkLogGroupName(owner: string, name: string | undefined): void {
  // The builder always seeds a name, but `configure` can replace it with a token.
  if (name === undefined || Token.isUnresolved(name)) return;
  if (!name.startsWith(WAF_LOG_GROUP_NAME_PREFIX)) {
    throw new Error(
      `${owner}: the WAF log group is named "${name}", but AWS WAF only logs to log groups ` +
        `whose names start with "${WAF_LOG_GROUP_NAME_PREFIX}". Rename it, or leave the ` +
        `name to the builder. See ${LOGGING_SOURCE}.`,
    );
  }
}

/**
 * Creates the WAF log group and returns it with the ARN WAF accepts for it.
 */
function createLogGroup(
  scope: IConstruct,
  id: string,
  owner: string,
  webAcl: CfnWebACL,
  configure: WebAclLoggingConfig["configure"],
  context: Record<string, object>,
): { logGroup: LogGroup; arn: string } {
  let builder = createLogGroupBuilder().logGroupName(
    `${WAF_LOG_GROUP_NAME_PREFIX}${webAclBaseName(webAcl)}`,
  );
  if (configure) builder = configure(builder);
  checkLogGroupName(owner, builder.logGroupName());
  const logGroup = builder.build(scope, `${id}Logs`, context).logGroup;
  // WAF rejects the `:*` that `logGroupArn` ends in.
  const arn = logGroup.stack.formatArn({
    service: "logs",
    resource: "log-group",
    resourceName: logGroup.logGroupName,
    arnFormat: ArnFormat.COLON_RESOURCE_NAME,
  });
  return { logGroup, arn };
}

/**
 * Creates the web ACL's logging configuration and, unless a destination was
 * given, its log group.
 *
 * @internal
 */
export function configureLogging(
  scope: IConstruct,
  id: string,
  owner: string,
  webAcl: CfnWebACL,
  config: WebAclLoggingConfig | false,
  context: Record<string, object>,
): Pick<WebAclBuilderResult, "logGroup" | "logging"> {
  if (config === false) return {};
  const { configure, destination, filter, redact } = config;
  if (configure !== undefined && destination !== undefined) {
    throw new Error(
      `${owner}: logging 'configure' cannot be combined with 'destination' — the ` +
        `destination is user-managed and not built by this builder.`,
    );
  }

  const { logGroup, arn } =
    destination === undefined
      ? createLogGroup(scope, id, owner, webAcl, configure, context)
      : { logGroup: undefined, arn: resolve(destination, context) };

  const logging = new CfnLoggingConfiguration(scope, `${id}Logging`, {
    resourceArn: webAcl.attrArn,
    logDestinationConfigs: [arn],
    loggingFilter: loggingFilter(filter),
    redactedFields: redactedFields(owner, redact),
  });
  if (logGroup) logging.node.addDependency(logGroup);

  return { logGroup, logging };
}
