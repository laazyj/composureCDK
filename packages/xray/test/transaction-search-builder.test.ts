import { describe, expect, it } from "vitest";
import { Match } from "aws-cdk-lib/assertions";
import { buildFixture } from "@composurecdk/cdk-testing";
import { createTransactionSearchBuilder } from "../src/transaction-search-builder.js";

const buildAndSynth = buildFixture(createTransactionSearchBuilder, "TransactionSearch");

describe("createTransactionSearchBuilder", () => {
  it("indexes 1% of spans by default", () => {
    const { template } = buildAndSynth();

    template.hasResourceProperties("AWS::XRay::TransactionSearchConfig", {
      IndexingPercentage: 1,
    });
  });

  it("accepts another indexing percentage", () => {
    const { template } = buildAndSynth((b) => b.indexingPercentage(10));

    template.hasResourceProperties("AWS::XRay::TransactionSearchConfig", {
      IndexingPercentage: 10,
    });
  });

  it("lets only X-Ray in this account write spans", () => {
    const { template } = buildAndSynth();

    // The document is an Fn::Join of tokens, so it is matched as text.
    const policy = JSON.stringify(template.findResources("AWS::Logs::ResourcePolicy"));
    for (const part of [
      "xray.amazonaws.com",
      "logs:PutLogEvents",
      "aws/spans:*",
      "/aws/application-signals/data:*",
      "aws:SourceAccount",
      "aws:SourceArn",
    ]) {
      expect(policy).toContain(part);
    }
  });

  it("enables search only once X-Ray can write spans", () => {
    const { template } = buildAndSynth();

    template.hasResource("AWS::XRay::TransactionSearchConfig", {
      DependsOn: [Match.stringLikeRegexp("LogsPolicy")],
    });
  });
});
