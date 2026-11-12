/** An action a logging filter condition can match on. */
export type WebAclLogAction =
  "ALLOW" | "BLOCK" | "COUNT" | "CAPTCHA" | "CHALLENGE" | "EXCLUDED_AS_COUNT";

/** One condition of a {@link WebAclLoggingFilter} filter: an action or a label. */
export type WebAclLogCondition = { action: WebAclLogAction } | { label: string };

/**
 * Which requests WAF writes to the log, typed. The builder turns it into the
 * PascalCase JSON CloudFormation's `LoggingFilter` expects, which CDK types
 * as `any`.
 *
 * @see https://docs.aws.amazon.com/waf/latest/APIReference/API_LoggingFilter.html
 */
export interface WebAclLoggingFilter {
  /** What to do with a request no filter matches. */
  readonly defaultBehavior: "KEEP" | "DROP";
  readonly filters: readonly {
    readonly behavior: "KEEP" | "DROP";
    readonly requirement: "MEETS_ALL" | "MEETS_ANY";
    readonly conditions: readonly WebAclLogCondition[];
  }[];
}

/** @internal — `LoggingFilter` is `any` in CDK, so this emits CloudFormation's PascalCase. */
export function toFilterProperty(filter: WebAclLoggingFilter): unknown {
  return {
    DefaultBehavior: filter.defaultBehavior,
    Filters: filter.filters.map((f) => ({
      Behavior: f.behavior,
      Requirement: f.requirement,
      Conditions: f.conditions.map((c) =>
        "action" in c
          ? { ActionCondition: { Action: c.action } }
          : { LabelNameCondition: { LabelName: c.label } },
      ),
    })),
  };
}
