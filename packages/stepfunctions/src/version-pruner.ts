import { CustomResource, Duration } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Code, Function as LambdaFunction, Runtime, RuntimeFamily } from "aws-cdk-lib/aws-lambda";
import { type LogGroup } from "aws-cdk-lib/aws-logs";
import { type IStateMachine } from "aws-cdk-lib/aws-stepfunctions";
import { Provider } from "aws-cdk-lib/custom-resources";
import { type IConstruct } from "constructs";
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

/**
 * The custom resource behind {@link IStateMachineBuilder.publishVersion}'s
 * retention limit. Both provider Lambdas write to `logGroup`.
 */
export function pruneStateMachineVersions(
  scope: IConstruct,
  id: string,
  stateMachine: IStateMachine,
  versionArn: string,
  retain: number,
  logGroup: LogGroup,
): CustomResource {
  // A magic-string runtime, as in @composurecdk/ses's activation provider: the
  // enum member would pull the aws-cdk-lib floor up, and constructing it at
  // module scope would mutate CDK's shared `Runtime.ALL` on import.
  const runtime = new Runtime("nodejs24.x", RuntimeFamily.NODEJS, { supportsInlineCode: true });
  const onEvent = new LambdaFunction(scope, `${id}Fn`, {
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
      // The state machine, and its qualified version and alias ARNs.
      resources: [stateMachine.stateMachineArn, `${stateMachine.stateMachineArn}:*`],
    }),
  );
  const provider = new Provider(scope, `${id}Provider`, { onEventHandler: onEvent, logGroup });
  return new CustomResource(scope, id, {
    serviceToken: provider.serviceToken,
    resourceType: "Custom::StepFunctionsVersionPruner",
    // VersionArn changes with each published version, so each one re-runs pruning.
    properties: {
      StateMachineArn: stateMachine.stateMachineArn,
      Retain: retain,
      VersionArn: versionArn,
    },
  });
}
