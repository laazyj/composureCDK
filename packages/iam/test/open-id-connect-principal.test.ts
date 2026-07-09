import { describe, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { OpenIdConnectProvider } from "aws-cdk-lib/aws-iam";
import { createRoleBuilder } from "../src/role-builder.js";
import { openIdConnectPrincipal } from "../src/open-id-connect-principal.js";

const PROVIDER_ARN = "arn:aws:iam::123456789012:oidc-provider/token.actions.githubusercontent.com";
const ISSUER_HOST = "token.actions.githubusercontent.com";

function trustPolicyOf(
  configure: (stack: Stack, provider: OpenIdConnectProvider) => void,
): Template {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const provider = OpenIdConnectProvider.fromOpenIdConnectProviderArn(
    stack,
    "Provider",
    PROVIDER_ARN,
  ) as OpenIdConnectProvider;
  configure(stack, provider);
  return Template.fromStack(stack);
}

describe("openIdConnectPrincipal", () => {
  it("federates the role trust policy with sts:AssumeRoleWithWebIdentity", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(openIdConnectPrincipal({ provider, issuerHost: ISSUER_HOST }))
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: "Allow",
            Action: "sts:AssumeRoleWithWebIdentity",
            Principal: { Federated: PROVIDER_ARN },
          }),
        ]),
      }),
    });
  });

  it("prefixes every claim key with the issuer host and maps to the chosen operator", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            stringEquals: { aud: "sts.amazonaws.com" },
            stringLike: { sub: ["repo:acme/app:ref:refs/heads/main"] },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: {
              StringEquals: { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
              StringLike: {
                "token.actions.githubusercontent.com:sub": ["repo:acme/app:ref:refs/heads/main"],
              },
            },
          }),
        ]),
      }),
    });
  });

  it("omits condition operators that are not supplied", () => {
    const template = trustPolicyOf((stack, provider) => {
      createRoleBuilder()
        .assumedBy(
          openIdConnectPrincipal({
            provider,
            issuerHost: ISSUER_HOST,
            stringLike: { sub: ["repo:acme/app:pull_request"] },
          }),
        )
        .build(stack, "Role");
    });

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Condition: Match.objectLike({
              StringLike: {
                "token.actions.githubusercontent.com:sub": ["repo:acme/app:pull_request"],
              },
            }),
          }),
        ]),
      }),
    });
  });
});
