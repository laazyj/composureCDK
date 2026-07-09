import { describe, expect, it } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { createRoleBuilder } from "../src/role-builder.js";
import * as githubActions from "../src/github-actions.js";

const OIDC_RESOURCE = "Custom::AWSCDKOpenIdConnectProvider";
const ISSUER_HOST = "token.actions.githubusercontent.com";
const ENV = { account: "123456789012", region: "us-east-1" };

describe("githubActions.Subject", () => {
  const forRepo = "acme/app";

  it("formats every workflow-scoping shape", () => {
    expect(githubActions.Subject.branch("main")(forRepo)).toBe("repo:acme/app:ref:refs/heads/main");
    expect(githubActions.Subject.tag("v*")(forRepo)).toBe("repo:acme/app:ref:refs/tags/v*");
    expect(githubActions.Subject.pullRequest()(forRepo)).toBe("repo:acme/app:pull_request");
    expect(githubActions.Subject.environment("prod")(forRepo)).toBe(
      "repo:acme/app:environment:prod",
    );
    expect(githubActions.Subject.custom("ref:refs/heads/*")(forRepo)).toBe(
      "repo:acme/app:ref:refs/heads/*",
    );
  });
});

describe("githubActions.provider", () => {
  it("presets the GitHub issuer URL and audience", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    githubActions.provider().build(stack, "GithubOidcProvider");

    Template.fromStack(stack).hasResourceProperties(
      OIDC_RESOURCE,
      Match.objectLike({
        Url: "https://token.actions.githubusercontent.com",
        ClientIDList: ["sts.amazonaws.com"],
      }),
    );
  });

  it("keeps preset values overridable", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    githubActions.provider().clientIds(["sts.amazonaws.com", "other"]).build(stack, "P");

    Template.fromStack(stack).hasResourceProperties(
      OIDC_RESOURCE,
      Match.objectLike({ ClientIDList: ["sts.amazonaws.com", "other"] }),
    );
  });
});

describe("githubActions.principal", () => {
  function roleTrustPolicy(
    subjects: Parameters<typeof githubActions.principal>[0]["subjects"],
  ): Template {
    const app = new App();
    const stack = new Stack(app, "TestStack", { env: ENV });
    const provider = githubActions.importProvider(stack, "Provider");
    createRoleBuilder()
      .assumedBy(githubActions.principal({ owner: "acme", repo: "app", provider, subjects }))
      .build(stack, "Role");
    return Template.fromStack(stack);
  }

  it("pins aud with StringEquals and scopes sub with StringLike", () => {
    const template = roleTrustPolicy([
      githubActions.Subject.branch("main"),
      githubActions.Subject.pullRequest(),
    ]);

    template.hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: {
              StringEquals: { [`${ISSUER_HOST}:aud`]: "sts.amazonaws.com" },
              StringLike: {
                [`${ISSUER_HOST}:sub`]: [
                  "repo:acme/app:ref:refs/heads/main",
                  "repo:acme/app:pull_request",
                ],
              },
            },
          }),
        ]),
      }),
    });
  });

  it("throws when the subject list is empty", () => {
    expect(() => roleTrustPolicy([])).toThrow(/at least one subject is required/);
  });

  it("throws when owner or repo is empty or contains a slash", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack", { env: ENV });
    const provider = githubActions.importProvider(stack, "Provider");

    expect(() =>
      githubActions.principal({
        owner: "",
        repo: "app",
        provider,
        subjects: [githubActions.Subject.branch("main")],
      }),
    ).toThrow(/owner must be a non-empty value without "\/"/);

    expect(() =>
      githubActions.principal({
        owner: "acme",
        repo: "group/app",
        provider,
        subjects: [githubActions.Subject.branch("main")],
      }),
    ).toThrow(/repo must be a non-empty value without "\/"/);
  });
});

describe("githubActions.importProvider", () => {
  it("references the account-singleton provider by its conventional ARN", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack", { env: ENV });
    const provider = githubActions.importProvider(stack, "Provider");

    createRoleBuilder()
      .assumedBy(
        githubActions.principal({
          owner: "acme",
          repo: "app",
          provider,
          subjects: [githubActions.Subject.branch("main")],
        }),
      )
      .build(stack, "Role");

    Template.fromStack(stack).hasResourceProperties("AWS::IAM::Role", {
      AssumeRolePolicyDocument: Match.objectLike({
        Statement: Match.arrayWith([
          Match.objectLike({
            Principal: {
              Federated: `arn:aws:iam::${ENV.account}:oidc-provider/${ISSUER_HOST}`,
            },
          }),
        ]),
      }),
    });
  });
});
