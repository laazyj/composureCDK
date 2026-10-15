import { ArnFormat, Aws, CustomResource, Duration, Stack } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Code, Function as LambdaFunction, Runtime, RuntimeFamily } from "aws-cdk-lib/aws-lambda";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type CfnStateMachine, type StateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Provider } from "aws-cdk-lib/custom-resources";
import { Construct, type IConstruct } from "constructs";
import { createLogGroupBuilder } from "@composurecdk/logs";
import { runVersionPruning, versionsToPrune } from "./version-pruner-handler.js";

/** The provider Lambda: the serialised decision logic plus a thin `@aws-sdk/client-sfn` adapter. */
const HANDLER = `
const {
  SFNClient,
  ListStateMachineVersionsCommand,
  ListStateMachineAliasesCommand,
  DescribeStateMachineAliasCommand,
  DeleteStateMachineVersionCommand,
} = require("@aws-sdk/client-sfn");
${versionsToPrune.toString()}
${runVersionPruning.toString()}
async function pages(send, key) {
  const items = [];
  let nextToken;
  do {
    const page = await send(nextToken);
    items.push(...page[key]);
    nextToken = page.nextToken;
  } while (nextToken);
  return items;
}
exports.handler = async (event) => {
  const sfn = new SFNClient({});
  const api = {
    listVersionArns: async (stateMachineArn) =>
      (await pages((nextToken) => sfn.send(new ListStateMachineVersionsCommand({ stateMachineArn, nextToken })), "stateMachineVersions"))
        .map((v) => v.stateMachineVersionArn),
    listAliasedVersionArns: async (stateMachineArn) => {
      const aliases = await pages((nextToken) => sfn.send(new ListStateMachineAliasesCommand({ stateMachineArn, nextToken })), "stateMachineAliases");
      const described = await Promise.all(aliases.map((a) =>
        sfn.send(new DescribeStateMachineAliasCommand({ stateMachineAliasArn: a.stateMachineAliasArn }))));
      return described.flatMap((d) => (d.routingConfiguration ?? []).map((r) => r.stateMachineVersionArn));
    },
    deleteVersion: async (stateMachineVersionArn) => {
      await sfn.send(new DeleteStateMachineVersionCommand({ stateMachineVersionArn }));
    },
  };
  return runVersionPruning(event, api);
};
`;

/** Tag key marking a state machine its stack's version pruner may prune. */
export const VERSION_PRUNER_TAG_KEY = "composurecdk:version-pruner";

/** Construct id of the stack's one version pruner, under the stack itself. */
const VERSION_PRUNER_ID = "ComposureCDKStepFunctionsVersionPruner";

/**
 * The stack's version-pruner provider, created by the first versioned state
 * machine and shared by every later one, which is why only the first
 * one's `context` reaches the log group. It may act only on state machines
 * tagged {@link VERSION_PRUNER_TAG_KEY} with this stack's ID: Step Functions
 * authorises version and alias calls against the state machine, whose tags the
 * condition reads. The children are found by id rather than `instanceof`, so a
 * second copy of this package in the same process (ADR-0007) reuses them.
 *
 * @see https://docs.aws.amazon.com/step-functions/latest/dg/auth-version-alias.html
 */
function stackVersionPruner(
  scope: IConstruct,
  context?: Record<string, object>,
): { provider: Provider; logGroup: LogGroup } {
  const stack = Stack.of(scope);
  const existing = stack.node.tryFindChild(VERSION_PRUNER_ID);
  if (existing) {
    return {
      provider: existing.node.findChild("Provider") as Provider,
      logGroup: existing.node.findChild("Logs") as LogGroup,
    };
  }

  const container = new Construct(stack, VERSION_PRUNER_ID);
  const logGroup = createLogGroupBuilder().build(container, "Logs", context).logGroup;
  // A magic-string runtime, as in @composurecdk/ses's activation provider: the
  // enum member would pull the aws-cdk-lib floor up, and constructing it at
  // module scope would mutate CDK's shared `Runtime.ALL` on import.
  const runtime = new Runtime("nodejs24.x", RuntimeFamily.NODEJS, { supportsInlineCode: true });
  const onEvent = new LambdaFunction(container, "Fn", {
    runtime,
    logGroup,
    handler: "index.handler",
    code: Code.fromInline(HANDLER),
    timeout: Duration.minutes(5),
  });
  onEvent.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "states:ListStateMachineVersions",
        "states:ListStateMachineAliases",
        "states:DescribeStateMachineAlias",
        "states:DeleteStateMachineVersion",
      ],
      // Every state machine and its qualified ARNs, narrowed by the tag.
      resources: [
        stack.formatArn({
          service: "states",
          resource: "stateMachine",
          resourceName: "*",
          arnFormat: ArnFormat.COLON_RESOURCE_NAME,
        }),
      ],
      conditions: { StringEquals: { [`aws:ResourceTag/${VERSION_PRUNER_TAG_KEY}`]: Aws.STACK_ID } },
    }),
  );
  const provider = new Provider(container, "Provider", { onEventHandler: onEvent, logGroup });
  return { provider, logGroup };
}

/**
 * The custom resource behind {@link IStateMachineBuilder.publishVersion}'s
 * retention limit, served by the stack's shared provider. Tags the state
 * machine's L1 directly, not through an aspect, since the tag is a grant.
 */
export function pruneStateMachineVersions(
  scope: IConstruct,
  id: string,
  stateMachine: StateMachine,
  versionArn: string,
  retain: number,
  context?: Record<string, object>,
): { versionPruner: CustomResource; versionPrunerLogGroup: LogGroup } {
  const { provider, logGroup } = stackVersionPruner(scope, context);
  (stateMachine.node.defaultChild as CfnStateMachine).tags.setTag(
    VERSION_PRUNER_TAG_KEY,
    Aws.STACK_ID,
  );
  const versionPruner = new CustomResource(scope, id, {
    serviceToken: provider.serviceToken,
    resourceType: "Custom::StepFunctionsVersionPruner",
    // VersionArn changes with each published version, so each one re-runs pruning.
    properties: {
      StateMachineArn: stateMachine.stateMachineArn,
      Retain: retain,
      VersionArn: versionArn,
    },
  });
  return { versionPruner, versionPrunerLogGroup: logGroup };
}
