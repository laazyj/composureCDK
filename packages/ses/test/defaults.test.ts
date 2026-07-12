import { describe, expect, it } from "vitest";
import { MailFromBehaviorOnMxFailure, TlsPolicy } from "aws-cdk-lib/aws-ses";
import { DEFAULT_MAIL_FROM_BEHAVIOR_ON_MX_FAILURE, DEFAULT_RECEIPT_RULE } from "../src/defaults.js";

describe("defaults", () => {
  it("scans inbound mail by default", () => {
    expect(DEFAULT_RECEIPT_RULE.scanEnabled).toBe(true);
  });

  it("requires TLS by default", () => {
    expect(DEFAULT_RECEIPT_RULE.tlsPolicy).toBe(TlsPolicy.REQUIRE);
  });

  it("rejects on MX failure for a custom MAIL FROM by default", () => {
    expect(DEFAULT_MAIL_FROM_BEHAVIOR_ON_MX_FAILURE).toBe(
      MailFromBehaviorOnMxFailure.REJECT_MESSAGE,
    );
  });
});
