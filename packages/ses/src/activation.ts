import { CustomResource, Duration } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Code, Function as LambdaFunction, Runtime, RuntimeFamily } from "aws-cdk-lib/aws-lambda";
import { type IReceiptRuleSet } from "aws-cdk-lib/aws-ses";
import { Provider } from "aws-cdk-lib/custom-resources";
import { type IConstruct } from "constructs";
import { runActivation } from "./activation-handler.js";

/**
 * Node runtime for the provider Lambda. Constructed as a magic-string runtime
 * rather than the `Runtime.NODEJS_24_X` enum so adopting the latest LTS doesn't
 * pull the package's aws-cdk-lib floor up to whatever release introduced the
 * enum member (see cdk-floors.json).
 */
const NODE_RUNTIME = new Runtime("nodejs24.x", RuntimeFamily.NODEJS, { supportsInlineCode: true });

/**
 * The provider Lambda source. A rule set is inert until it is the account's
 * single **active** rule set — `ses:SetActiveReceiptRuleSet`, which has no
 * CloudFormation resource. The conditional-deactivate decision lives in the
 * type-checked, unit-tested {@link runActivation} (serialised here via
 * `.toString()`); only the SDK adapter is inline. `@aws-sdk/client-ses` is
 * provided by the Lambda runtime.
 */
const HANDLER = `
const { SESClient, SetActiveReceiptRuleSetCommand, DescribeActiveReceiptRuleSetCommand } = require("@aws-sdk/client-ses");
${runActivation.toString()}
exports.handler = async (event) => {
  const ses = new SESClient({});
  const api = {
    getActiveRuleSetName: async () =>
      (await ses.send(new DescribeActiveReceiptRuleSetCommand({}))).Metadata?.Name,
    setActive: async (name) => {
      await ses.send(new SetActiveReceiptRuleSetCommand(name ? { RuleSetName: name } : {}));
    },
  };
  return runActivation(event, api);
};
`;

/**
 * Makes `ruleSet` the account's active receipt rule set, and conditionally
 * deactivates it on delete. Bundled by
 * {@link IReceiptRuleSetBuilder.activate | `.activate()`}; returned on the build
 * result so consumers can reference the custom resource.
 */
export function activateReceiptRuleSet(
  scope: IConstruct,
  id: string,
  ruleSet: IReceiptRuleSet,
): CustomResource {
  const onEvent = new LambdaFunction(scope, `${id}Fn`, {
    runtime: NODE_RUNTIME,
    handler: "index.handler",
    code: Code.fromInline(HANDLER),
    timeout: Duration.minutes(1),
  });
  // Account-level actions: SES rule-set activation is not resource-scoped.
  onEvent.addToRolePolicy(
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ses:SetActiveReceiptRuleSet", "ses:DescribeActiveReceiptRuleSet"],
      resources: ["*"],
    }),
  );
  const provider = new Provider(scope, `${id}Provider`, { onEventHandler: onEvent });
  return new CustomResource(scope, id, {
    serviceToken: provider.serviceToken,
    resourceType: "Custom::SESActiveReceiptRuleSet",
    properties: { RuleSetName: ruleSet.receiptRuleSetName },
  });
}
