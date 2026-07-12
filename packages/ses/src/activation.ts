import { CustomResource, Duration } from "aws-cdk-lib";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Code, Function as LambdaFunction, Runtime } from "aws-cdk-lib/aws-lambda";
import { type IReceiptRuleSet } from "aws-cdk-lib/aws-ses";
import { Provider } from "aws-cdk-lib/custom-resources";
import { type IConstruct } from "constructs";

/**
 * Provider handler for the rule-set activation custom resource.
 *
 * A rule set is inert until it is the account's single **active** rule set —
 * `ses:SetActiveReceiptRuleSet`, which has no CloudFormation resource. On
 * create/update it activates the named rule set. On delete it **conditionally
 * deactivates**: it clears the active slot only when the currently-active set
 * is the one being deleted, so tearing down this stack never disables another
 * stack's rule set. (A single-call `AwsCustomResource` cannot express this
 * describe-then-act logic, which is why activation uses a purpose-built
 * provider.) `@aws-sdk/client-ses` is provided by the Lambda runtime.
 */
const HANDLER = `
const { SESClient, SetActiveReceiptRuleSetCommand, DescribeActiveReceiptRuleSetCommand } = require("@aws-sdk/client-ses");
exports.handler = async (event) => {
  const ses = new SESClient({});
  const name = event.ResourceProperties.RuleSetName;
  const PhysicalResourceId = "ses-active-rule-set-" + name;
  if (event.RequestType === "Delete") {
    const active = await ses.send(new DescribeActiveReceiptRuleSetCommand({}));
    if (active && active.Metadata && active.Metadata.Name === name) {
      await ses.send(new SetActiveReceiptRuleSetCommand({}));
    }
    return { PhysicalResourceId };
  }
  await ses.send(new SetActiveReceiptRuleSetCommand({ RuleSetName: name }));
  return { PhysicalResourceId };
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
    runtime: Runtime.NODEJS_20_X,
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
