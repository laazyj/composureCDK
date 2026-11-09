import { Annotations, ArnFormat, Names, Stack } from "aws-cdk-lib";
import { type IRuleTarget, type RuleTargetConfig } from "aws-cdk-lib/aws-events";
import {
  addToDeadLetterQueueResourcePolicy,
  bindBaseTargetConfig,
  SqsQueue,
  type SqsQueueProps,
} from "aws-cdk-lib/aws-events-targets";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import type { IConstruct } from "constructs";
import { isRef, type Resolvable } from "@composurecdk/core";
import { isCfnRule } from "../cfn-rule.js";

/**
 * Warning emitted when an {@link sqsTarget}'s queue is encrypted with a KMS
 * key whose policy cannot be changed from this app (an imported key, or the
 * AWS-managed `alias/aws/sqs`), so EventBridge cannot be granted the access
 * it needs to send to the queue. Acknowledge it with
 * `Annotations.of(rule).acknowledgeWarning(SQS_TARGET_KEY_WARNING_ID)` once
 * the key policy has been updated where the key is owned.
 */
export const SQS_TARGET_KEY_WARNING_ID = "@composurecdk/events:sqs-target-key-not-granted";

type Queue = ConstructorParameters<typeof SqsQueue>[0];
type BoundRule = Parameters<IRuleTarget["bind"]>[0];

/**
 * Wraps an SQS queue as an EventBridge {@link IRuleTarget}, deferring
 * resolution if the queue is a {@link Ref} to a sibling component's output.
 *
 * Mirrors the {@link SqsQueue} target from `aws-events-targets` — `props`
 * accepts {@link SqsQueueProps.message} for input transformation,
 * {@link SqsQueueProps.messageGroupId} (required for FIFO targets), plus the
 * `deadLetterQueue` / `maxEventAge` / `retryAttempts` reliability options
 * from the inherited base.
 *
 * For a queue without a KMS key, binding is CDK's own. For a queue with a
 * customer-managed key, CDK drops the `aws:SourceArn` scoping (to avoid a
 * key → rule → queue → key dependency cycle) and grants EventBridge
 * unconditioned use of the key. This target keeps both grants scoped to the
 * rule instead:
 *
 * - The rule is given a literal name, if it has none, so its ARN can be
 *   written without referencing the rule resource.
 * - The queue policy grants `sqs:SendMessage` alone, on `aws:SourceArn`.
 * - The key policy grants `kms:GenerateDataKey` and `kms:Decrypt` alone, on
 *   `aws:SourceArn` and `aws:SourceAccount`.
 *
 * When the key's policy can't be changed here, a warning
 * ({@link SQS_TARGET_KEY_WARNING_ID}) says what to grant.
 *
 * `queue` reads its type from CDK's own target constructor rather than
 * naming `IQueue`, so it keeps tracking the installed `aws-cdk-lib`
 * (ADR-0018).
 */
export function sqsTarget(
  queue: Resolvable<Queue>,
  props?: SqsQueueProps,
): Resolvable<IRuleTarget> {
  if (isRef(queue)) return queue.map((resolved) => new ScopedSqsQueue(resolved, props));
  return new ScopedSqsQueue(queue, props);
}

class ScopedSqsQueue implements IRuleTarget {
  readonly #queue: Queue;
  readonly #props: SqsQueueProps;

  constructor(queue: Queue, props: SqsQueueProps = {}) {
    this.#queue = queue;
    this.#props = props;
  }

  bind(rule: BoundRule, id?: string): RuleTargetConfig {
    const queue = this.#queue;
    const props = this.#props;
    const key = queue.encryptionMasterKey;
    if (key === undefined) return new SqsQueue(queue, props).bind(rule, id);

    const stack = Stack.of(rule);
    const principal = new ServicePrincipal("events.amazonaws.com");
    const ruleArn = literalRuleArn(stack, rule);

    queue.addToResourcePolicy(
      new PolicyStatement({
        principals: [principal],
        actions: ["sqs:SendMessage"],
        resources: [queue.queueArn],
        conditions: { ArnEquals: { "aws:SourceArn": ruleArn } },
      }),
    );

    const keyStatement = new PolicyStatement({
      principals: [principal],
      actions: ["kms:GenerateDataKey", "kms:Decrypt"],
      resources: ["*"],
      conditions: {
        ArnEquals: { "aws:SourceArn": ruleArn },
        StringEquals: { "aws:SourceAccount": stack.account },
      },
    });
    if (!key.addToResourcePolicy(keyStatement).statementAdded) {
      warn(
        rule,
        `SQS target ${queue.node.path}: the queue's KMS key is imported or AWS-managed, ` +
          `so its key policy can't be updated here. Add this statement to the key policy, or ` +
          `EventBridge will fail to deliver to the queue: ` +
          JSON.stringify(stack.resolve(keyStatement.toStatementJson())),
      );
    }

    // From here on, the same as CDK's `SqsQueue.bind` after its grants;
    // compare the two after a CDK upgrade.
    if (props.deadLetterQueue) {
      addToDeadLetterQueueResourcePolicy(rule, props.deadLetterQueue);
    }

    return {
      ...bindBaseTargetConfig(props),
      arn: queue.queueArn,
      input: props.message,
      targetResource: queue,
      sqsParameters: props.messageGroupId ? { messageGroupId: props.messageGroupId } : undefined,
    };
  }
}

/**
 * The rule's ARN, built from its literal name rather than read off the rule
 * resource, so the key policy can carry it without a dependency cycle. Names
 * the rule's L1 when it has no name — the L2's `ruleName` is always a
 * reference, which is the cycle this avoids.
 */
function literalRuleArn(stack: Stack, rule: BoundRule): string {
  const cfnRule = rule.node.defaultChild;
  if (!isCfnRule(cfnRule)) {
    throw new Error(
      `sqsTarget: rule ${rule.node.path} has no AWS::Events::Rule resource to scope the ` +
        "queue's KMS key grant to. Bind it to a rule defined in this app.",
    );
  }
  // `Rule` sets `name` to a lazy token over its physical name, so "unnamed"
  // shows only once resolved.
  let name = cfnRule.name;
  if (name === undefined || stack.resolve(name) === undefined) {
    name = Names.uniqueResourceName(rule, { maxLength: 64 });
    cfnRule.name = name;
  }

  const bus = cfnRule.eventBusName;
  return stack.formatArn({
    service: "events",
    resource: "rule",
    resourceName: bus === undefined || bus === "default" ? name : `${bus}/${name}`,
    arnFormat: ArnFormat.SLASH_RESOURCE_NAME,
  });
}

interface WarningAnnotations {
  addWarningV2?: (id: string, message: string) => void;
  addWarning: (message: string) => void;
}

/**
 * Emits {@link SQS_TARGET_KEY_WARNING_ID} where the runtime supports
 * acknowledgeable warnings. `Annotations.addWarningV2` only exists from
 * aws-cdk-lib 2.93.0, above this package's floor, so this degrades to
 * `addWarning` — the same shim as `@composurecdk/cloudformation`'s
 * template-text policy.
 */
function warn(node: IConstruct, message: string): void {
  const annotations = Annotations.of(node) as unknown as WarningAnnotations;
  if (typeof annotations.addWarningV2 === "function") {
    annotations.addWarningV2(SQS_TARGET_KEY_WARNING_ID, message);
    return;
  }
  annotations.addWarning(message);
}
