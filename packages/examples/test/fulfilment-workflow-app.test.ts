import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createFulfilmentWorkflowApp } from "../src/fulfilment-workflow-app.js";

describe("fulfilment-workflow-app", () => {
  const { stack } = createFulfilmentWorkflowApp();
  const template = Template.fromStack(stack);

  /** A literal fragment of the state machine's ASL, which CDK renders as an `Fn::Join`. */
  const aslContains = (fragment: string) => {
    template.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      DefinitionString: {
        "Fn::Join": ["", Match.arrayWith([Match.stringLikeRegexp(fragment)])],
      },
    });
  };

  it("creates one state machine, bounded by a five-minute timeout", () => {
    template.resourceCountIs("AWS::StepFunctions::StateMachine", 1);
    aslContains('"StartAt":"CheckStock"');
    aslContains('"TimeoutSeconds":300');
  });

  it("catches OutOfStock as a business outcome that records the order and succeeds", () => {
    aslContains(
      '"Catch":\\[\\{"ErrorEquals":\\["OutOfStock"\\],"ResultPath":"\\$.error","Next":"RecordRejected"\\}\\]',
    );
    aslContains('"RecordRejected":\\{"Next":"Rejected"');
    aslContains('"Rejected":\\{"Type":"Succeed"\\}');
  });

  it("starts an execution for each OrderPlaced event, with its detail as input", () => {
    // The smoke test and the deploy-test role's events:source condition both
    // name this source literally; the assertion pins all three.
    template.hasResourceProperties("AWS::Events::Rule", {
      EventPattern: { source: ["composurecdk.examples.orders"], "detail-type": ["OrderPlaced"] },
      Targets: [Match.objectLike({ InputPath: "$.detail" })],
    });
  });

  it("matches the expected synthesised template", () => {
    expect(template.toJSON()).toMatchSnapshot();
  });
});
