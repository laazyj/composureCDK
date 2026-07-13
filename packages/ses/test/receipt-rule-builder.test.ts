import { describe, expect, it } from "vitest";
import { TlsPolicy } from "aws-cdk-lib/aws-ses";
import { addHeaderAction } from "../src/actions/index.js";
import { createReceiptRuleBuilder } from "../src/receipt-rule-builder.js";

describe("ReceiptRuleBuilder", () => {
  it("merges secure defaults into the options", () => {
    const options = createReceiptRuleBuilder().recipients(["a@example.com"]).toOptions({});
    expect(options.scanEnabled).toBe(true);
    expect(options.tlsPolicy).toBe(TlsPolicy.REQUIRE);
    expect(options.recipients).toEqual(["a@example.com"]);
    expect(options.actions).toBeUndefined();
  });

  it("resolves registered actions in order", () => {
    const options = createReceiptRuleBuilder()
      .addAction("header", addHeaderAction("X-A", "1"))
      .addAction("stop", addHeaderAction("X-B", "2"))
      .toOptions({});
    expect(options.actions).toHaveLength(2);
  });

  it("rejects duplicate action keys", () => {
    expect(() =>
      createReceiptRuleBuilder()
        .addAction("dup", addHeaderAction("X-A", "1"))
        .addAction("dup", addHeaderAction("X-B", "2")),
    ).toThrow(/duplicate key "dup"/);
  });

  it("copies action state independently", () => {
    const base = createReceiptRuleBuilder().addAction("header", addHeaderAction("X-A", "1"));
    const copy = base.copy();
    base.addAction("second", addHeaderAction("X-B", "2"));
    expect(copy.toOptions({}).actions).toHaveLength(1);
  });
});
