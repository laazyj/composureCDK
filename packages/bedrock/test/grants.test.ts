import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { FoundationModelIdentifier, ProvisionedModel } from "aws-cdk-lib/aws-bedrock";
import { AccountRootPrincipal, type IGrantable, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { newStack, policyJson, TEST_ACCOUNT, testEnv } from "@composurecdk/cdk-testing";
import { type Grant, ref } from "@composurecdk/core";
import { guardrailGrants, modelGrants } from "../src/grants.js";
import { type ApplicationInferenceProfile, inferenceProfile } from "../src/inference-profile.js";
import { type InferenceTarget, invocationArns } from "../src/inference-target.js";

const MODEL_ID = "anthropic.claude-haiku-4-5-20251001-v1:0";
const MODEL = new FoundationModelIdentifier(MODEL_ID);
const ACTIONS = ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"];
const REGION = "eu-west-1";
const PROFILE_ARN = `arn:aws:bedrock:${REGION}:${TEST_ACCOUNT}:inference-profile/eu.${MODEL_ID}`;
const GLOBAL_PROFILE_ARN = `arn:aws:bedrock:${REGION}:${TEST_ACCOUNT}:inference-profile/global.${MODEL_ID}`;
const fmArn = (region: string) => `arn:aws:bedrock:${region}::foundation-model/${MODEL_ID}`;

interface PolicyResource {
  Properties: { PolicyDocument: { Statement: unknown[] } };
}

/** An eu-west-1 stack whose ARNs carry a literal partition. */
function regionalStack(): Stack {
  const app = new App({ context: { "@aws-cdk/core:enablePartitionLiterals": true } });
  return new Stack(app, "TestStack", { env: testEnv(REGION) });
}

function roleIn(stack: Stack): Role {
  return new Role(stack, "Role", { assumedBy: new ServicePrincipal("lambda.amazonaws.com") });
}

const GUARDRAIL = {
  guardrailArn: `arn:aws:bedrock:${REGION}:${TEST_ACCOUNT}:guardrail/gr1`,
  version: "3",
};
const GUARDRAIL_ID = `${GUARDRAIL.guardrailArn}:${GUARDRAIL.version}`;

function statementsOf(grant: Grant<IGrantable>): unknown[] {
  const stack = regionalStack();
  grant.applyTo(roleIn(stack), {});
  const policies = Template.fromStack(stack).findResources("AWS::IAM::Policy");
  return Object.values(policies).flatMap(
    (p) => (p as PolicyResource).Properties.PolicyDocument.Statement,
  );
}

const statementsFor = (target: InferenceTarget) => statementsOf(modelGrants.invoke(target));

describe("modelGrants.invoke", () => {
  it("grants a foundation model in the source Region", () => {
    expect(statementsFor(MODEL)).toEqual([
      { Action: ACTIONS, Effect: "Allow", Resource: fmArn(REGION) },
    ]);
  });

  it("grants an IModel by its ARN", () => {
    const arn = "arn:aws:bedrock:eu-west-1:123456789012:provisioned-model/abc";
    const model = ProvisionedModel.fromProvisionedModelArn(new Stack(), "Model", arn);

    expect(statementsFor(model)).toEqual([{ Action: ACTIONS, Effect: "Allow", Resource: arn }]);
  });

  it("grants a geographic profile and its models in the source and every routing Region", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "eu",
      routingRegions: ["eu-central-1", "eu-west-3"],
    });

    expect(statementsFor(profile)).toEqual([
      { Action: ACTIONS, Effect: "Allow", Resource: PROFILE_ARN },
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: [fmArn(REGION), fmArn("eu-central-1"), fmArn("eu-west-3")],
        Condition: { StringEquals: { "bedrock:InferenceProfileArn": PROFILE_ARN } },
      },
    ]);
  });

  it("does not repeat the source Region when it is listed", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "eu",
      routingRegions: ["eu-central-1", REGION],
    });

    expect(statementsFor(profile)[1]).toMatchObject({
      Resource: [fmArn(REGION), fmArn("eu-central-1")],
    });
  });

  it("grants a global profile with the three statements the Bedrock user guide prescribes", () => {
    expect(statementsFor(inferenceProfile.global(MODEL))).toEqual([
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: GLOBAL_PROFILE_ARN,
        Condition: { StringEquals: { "aws:RequestedRegion": REGION } },
      },
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: fmArn(REGION),
        Condition: {
          StringEquals: {
            "aws:RequestedRegion": REGION,
            "bedrock:InferenceProfileArn": GLOBAL_PROFILE_ARN,
          },
        },
      },
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: `arn:aws:bedrock:::foundation-model/${MODEL_ID}`,
        Condition: {
          StringEquals: {
            "aws:RequestedRegion": "unspecified",
            "bedrock:InferenceProfileArn": GLOBAL_PROFILE_ARN,
          },
        },
      },
    ]);
  });

  it("resolves a Resolvable target from the build context", () => {
    const stack = regionalStack();

    modelGrants
      .invoke(ref<{ model: InferenceTarget }, InferenceTarget>("config", (r) => r.model))
      .applyTo(roleIn(stack), { config: { model: MODEL } });

    expect(policyJson(stack)).toContain(fmArn(REGION));
  });

  it("uses AWS pseudo-parameters for an env-agnostic stack", () => {
    const stack = newStack();
    modelGrants.invoke(MODEL).applyTo(roleIn(stack), {});

    expect(policyJson(stack)).toContain("AWS::Region");
  });

  it("accepts a principal outside any stack", () => {
    const grantee: IGrantable = { grantPrincipal: new AccountRootPrincipal() };

    expect(() => {
      modelGrants.invoke(MODEL).applyTo(grantee, {});
    }).not.toThrow();
  });
});

describe("invocationArns", () => {
  it("lists every resource a geographic profile needs", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "eu",
      routingRegions: ["eu-west-3"],
    });

    expect(invocationArns(profile, regionalStack())).toEqual([
      PROFILE_ARN,
      fmArn(REGION),
      fmArn("eu-west-3"),
    ]);
  });

  it("uses AWS pseudo-parameters without a scope", () => {
    const [arn] = invocationArns(MODEL);

    expect(new Stack().resolve(arn)).toEqual({
      "Fn::Join": [
        "",
        [
          "arn:",
          { Ref: "AWS::Partition" },
          ":bedrock:",
          { Ref: "AWS::Region" },
          `::foundation-model/${MODEL_ID}`,
        ],
      ],
    });
  });
});

describe("modelGrants.invoke with requireGuardrail", () => {
  it("conditions the allow on the guardrail, denies calls without it and lets it be applied", () => {
    expect(statementsOf(modelGrants.invoke(MODEL, { requireGuardrail: GUARDRAIL }))).toEqual([
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: fmArn(REGION),
        Condition: { StringEquals: { "bedrock:GuardrailIdentifier": GUARDRAIL_ID } },
      },
      {
        Action: ACTIONS,
        Effect: "Deny",
        Resource: fmArn(REGION),
        Condition: { StringNotEquals: { "bedrock:GuardrailIdentifier": GUARDRAIL_ID } },
      },
      { Action: "bedrock:ApplyGuardrail", Effect: "Allow", Resource: GUARDRAIL.guardrailArn },
    ]);
  });

  it("keeps a profile's own conditions alongside the guardrail's", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "eu",
      routingRegions: ["eu-west-3"],
    });

    expect(statementsOf(modelGrants.invoke(profile, { requireGuardrail: GUARDRAIL }))).toEqual([
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: PROFILE_ARN,
        Condition: { StringEquals: { "bedrock:GuardrailIdentifier": GUARDRAIL_ID } },
      },
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: [fmArn(REGION), fmArn("eu-west-3")],
        Condition: {
          StringEquals: {
            "bedrock:InferenceProfileArn": PROFILE_ARN,
            "bedrock:GuardrailIdentifier": GUARDRAIL_ID,
          },
        },
      },
      {
        Action: ACTIONS,
        Effect: "Deny",
        Resource: [PROFILE_ARN, fmArn(REGION), fmArn("eu-west-3")],
        Condition: { StringNotEquals: { "bedrock:GuardrailIdentifier": GUARDRAIL_ID } },
      },
      { Action: "bedrock:ApplyGuardrail", Effect: "Allow", Resource: GUARDRAIL.guardrailArn },
    ]);
  });

  it("resolves the target and guardrail from the build context", () => {
    const stack = regionalStack();

    modelGrants
      .invoke(
        ref<{ model: InferenceTarget }, InferenceTarget>("config", (r) => r.model),
        {
          requireGuardrail: ref<{ guardrail: typeof GUARDRAIL }, typeof GUARDRAIL>(
            "safety",
            (r) => r.guardrail,
          ),
        },
      )
      .applyTo(roleIn(stack), { config: { model: MODEL }, safety: { guardrail: GUARDRAIL } });

    expect(policyJson(stack)).toContain(GUARDRAIL_ID);
  });
});

describe("guardrailGrants.apply", () => {
  it("allows applying the guardrail", () => {
    expect(statementsOf(guardrailGrants.apply(GUARDRAIL))).toEqual([
      { Action: "bedrock:ApplyGuardrail", Effect: "Allow", Resource: GUARDRAIL.guardrailArn },
    ]);
  });
});

describe("modelGrants.invoke on an application inference profile", () => {
  const APP_ARN = `arn:aws:bedrock:${REGION}:${TEST_ACCOUNT}:application-inference-profile/app1`;
  const app = (source: ApplicationInferenceProfile["source"]): ApplicationInferenceProfile => ({
    kind: "application",
    profileArn: APP_ARN,
    profileId: "app1",
    source,
  });

  it("grants the profile and its model, reachable only through the profile", () => {
    expect(statementsFor(app(MODEL))).toEqual([
      { Action: ACTIONS, Effect: "Allow", Resource: APP_ARN },
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: fmArn(REGION),
        Condition: { StringEquals: { "bedrock:InferenceProfileArn": APP_ARN } },
      },
    ]);
  });

  it("scopes a system-defined source's models to the application profile alone", () => {
    const profile = inferenceProfile.geographic({
      model: MODEL,
      geography: "eu",
      routingRegions: ["eu-west-3"],
    });

    expect(statementsFor(app(profile))).toEqual([
      { Action: ACTIONS, Effect: "Allow", Resource: APP_ARN },
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: [fmArn(REGION), fmArn("eu-west-3")],
        Condition: { StringEquals: { "bedrock:InferenceProfileArn": APP_ARN } },
      },
    ]);
  });

  it("requires a guardrail through the application profile", () => {
    const statements = statementsOf(
      modelGrants.invoke(app(MODEL), { requireGuardrail: GUARDRAIL }),
    );

    expect(statements).toContainEqual({
      Action: ACTIONS,
      Effect: "Allow",
      Resource: fmArn(REGION),
      Condition: {
        StringEquals: {
          "bedrock:InferenceProfileArn": APP_ARN,
          "bedrock:GuardrailIdentifier": GUARDRAIL_ID,
        },
      },
    });
    expect(statements).toContainEqual({
      Action: ACTIONS,
      Effect: "Deny",
      Resource: [APP_ARN, fmArn(REGION)],
      Condition: { StringNotEquals: { "bedrock:GuardrailIdentifier": GUARDRAIL_ID } },
    });
  });

  it("keeps a global source's Region conditions and grants no global profile", () => {
    expect(statementsFor(app(inferenceProfile.global(MODEL)))).toEqual([
      { Action: ACTIONS, Effect: "Allow", Resource: APP_ARN },
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: fmArn(REGION),
        Condition: {
          StringEquals: { "aws:RequestedRegion": REGION, "bedrock:InferenceProfileArn": APP_ARN },
        },
      },
      {
        Action: ACTIONS,
        Effect: "Allow",
        Resource: `arn:aws:bedrock:::foundation-model/${MODEL_ID}`,
        Condition: {
          StringEquals: {
            "aws:RequestedRegion": "unspecified",
            "bedrock:InferenceProfileArn": APP_ARN,
          },
        },
      },
    ]);
  });
});
