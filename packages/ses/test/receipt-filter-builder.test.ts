import { describe, expect, it } from "vitest";
import { Match, Template } from "aws-cdk-lib/assertions";
import { ReceiptFilterPolicy } from "aws-cdk-lib/aws-ses";
import { newStack, testEnv } from "@composurecdk/cdk-testing";
import {
  createAllowListReceiptFilterBuilder,
  createReceiptFilterBuilder,
} from "../src/receipt-filter-builder.js";

describe("ReceiptFilterBuilder", () => {
  it("blocks an IP range", () => {
    const stack = newStack({ env: testEnv("us-east-1") });
    const { receiptFilter } = createReceiptFilterBuilder()
      .ip("10.0.0.0/24")
      .policy(ReceiptFilterPolicy.BLOCK)
      .build(stack, "Blocklist");
    expect(receiptFilter).toBeDefined();
    Template.fromStack(stack).hasResourceProperties("AWS::SES::ReceiptFilter", {
      Filter: Match.objectLike({
        IpFilter: Match.objectLike({ Cidr: "10.0.0.0/24", Policy: "Block" }),
      }),
    });
  });
});

describe("AllowListReceiptFilterBuilder", () => {
  it("blocks all but the allowed IPs", () => {
    const stack = newStack({ env: testEnv("us-east-1") });
    const { allowList } = createAllowListReceiptFilterBuilder()
      .ips(["10.0.0.1/32"])
      .build(stack, "Allowlist");
    expect(allowList).toBeDefined();
    // One block-all filter plus one allow filter per IP.
    Template.fromStack(stack).resourceCountIs("AWS::SES::ReceiptFilter", 2);
  });

  it("throws when no IPs are supplied", () => {
    const stack = newStack({ env: testEnv("us-east-1") });
    expect(() => createAllowListReceiptFilterBuilder().build(stack, "Allowlist")).toThrow(
      /call \.ips\(\[\.\.\.\]\)/,
    );
  });
});
