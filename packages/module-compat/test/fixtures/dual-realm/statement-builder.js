// Loads `@composurecdk/iam` through BOTH export conditions in one process —
// the dual-package hazard itself (ADR-0007), not a stand-in for it. A
// StatementBuilder is constructed with the ESM copy and handed to a role
// builder and a managed-policy builder from the CommonJS copy, which is the
// shape a real app takes when its ESM entrypoint assembles statements and a
// CJS module builds the role.

import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { App, Stack } from "aws-cdk-lib";
import { ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { createStatementBuilder, StatementBuilder } from "@composurecdk/iam";

const cjs = createRequire(import.meta.url)("@composurecdk/iam");

// Without this, everything below could pass for the wrong reason.
assert.notEqual(cjs.StatementBuilder, StatementBuilder);
assert.equal(createStatementBuilder() instanceof cjs.StatementBuilder, false);
assert.equal(cjs.isStatementBuilder(createStatementBuilder()), true);

const app = new App();
const stack = new Stack(app, "ComposureCDK-ModuleCompatDualRealm");

cjs
  .createRoleBuilder()
  .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
  .addInlinePolicyStatements("FromEsm", [
    createStatementBuilder().allow().actions(["s3:GetObject"]).resources(["arn:aws:s3:::bucket/*"]),
  ])
  .build(stack, "Role");

cjs
  .createManagedPolicyBuilder()
  .addStatements([
    createStatementBuilder().allow().actions(["s3:PutObject"]).resources(["arn:aws:s3:::bucket/*"]),
  ])
  .build(stack, "Policy");

const template = JSON.stringify(
  app.synth().getStackByName("ComposureCDK-ModuleCompatDualRealm").template,
);
assert.ok(template.includes("s3:GetObject"), "ESM statement missing from the CJS-built role");
assert.ok(template.includes("s3:PutObject"), "ESM statement missing from the CJS-built policy");

// The wildcard guard lives in StatementBuilder.build(), so it only fires if the
// CJS builder recognised the ESM builder and called it. The error is thrown by
// the ESM copy, so it is not an instance of `cjs.WildcardResourceError` —
// match on the name, which both copies share.
assert.throws(
  () =>
    cjs
      .createRoleBuilder()
      .assumedBy(new ServicePrincipal("lambda.amazonaws.com"))
      .addInlinePolicyStatements("TooBroad", [
        createStatementBuilder().allow().actions(["ec2:DescribeInstances"]).resources(["*"]),
      ])
      .build(new Stack(new App(), "Wildcard"), "Role"),
  (error) => error.name === "WildcardResourceError",
);
