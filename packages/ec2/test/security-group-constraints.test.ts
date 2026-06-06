import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Vpc } from "aws-cdk-lib/aws-ec2";
import {
  validateSecurityGroupDescription,
  validateSecurityGroupName,
} from "../src/security-group-constraints.js";
import { createSecurityGroupBuilder } from "../src/security-group-builder.js";

describe("validateSecurityGroupDescription", () => {
  it("accepts the documented EC2 character set", () => {
    expect(() => {
      validateSecurityGroupDescription("Bastion host - SSH (port 22) [prod] ._:/#,@+=&;{}!$*");
    }).not.toThrow();
  });

  it("rejects non-ASCII characters such as an em-dash", () => {
    expect(() => {
      validateSecurityGroupDescription("Bastion — SSH entry point");
    }).toThrow(/is invalid/);
  });

  it("rejects descriptions longer than 255 characters", () => {
    expect(() => {
      validateSecurityGroupDescription("a".repeat(256));
    }).toThrow(/exceeds the 255-character limit/);
  });
});

describe("validateSecurityGroupName", () => {
  it("accepts a valid name", () => {
    expect(() => {
      validateSecurityGroupName("bastion-sg");
    }).not.toThrow();
  });

  it("rejects the reserved sg- prefix", () => {
    expect(() => {
      validateSecurityGroupName("sg-1234");
    }).toThrow(/reserved "sg-" prefix/);
  });
});

describe("SecurityGroupBuilder validates at synth", () => {
  function vpc(): { stack: Stack; vpc: Vpc } {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    return { stack, vpc: new Vpc(stack, "TestVpc", { maxAzs: 2, natGateways: 0 }) };
  }

  it("throws on an invalid description at build time", () => {
    const { stack, vpc: v } = vpc();
    const builder = createSecurityGroupBuilder().vpc(v).description("Bastion — SSH entry point");
    expect(() => builder.build(stack, "Sg")).toThrow(/is invalid/);
  });

  it("builds with a valid description", () => {
    const { stack, vpc: v } = vpc();
    const builder = createSecurityGroupBuilder().vpc(v).description("Bastion host - SSH");
    expect(() => builder.build(stack, "Sg")).not.toThrow();
  });
});
