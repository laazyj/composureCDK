import { App, Stack } from "aws-cdk-lib";
import { SnsAction } from "aws-cdk-lib/aws-cloudwatch-actions";
import { AttributeType, BillingMode } from "aws-cdk-lib/aws-dynamodb";
import { Key } from "aws-cdk-lib/aws-kms";
import { compose } from "@composurecdk/core";
import { alarmActionsPolicy } from "@composurecdk/cloudwatch";
import { createTableBuilder } from "@composurecdk/dynamodb";
import { createTopicBuilder } from "@composurecdk/sns";

/**
 * A financial ledger on the classic `createTableBuilder` (a `Table` /
 * `AWS::DynamoDB::Table`), demonstrating the classic builder and three
 * deliberate deviations from its secure defaults.
 *
 * Prefer `createTableV2Builder` for new tables (see `event-store-app.ts`); the
 * classic builder exists for `importSource` (S3 bulk import, V1-only) and
 * parity with existing classic tables. A ledger with steady, forecastable
 * throughput is a fair case for the classic builder and provisioned capacity.
 *
 * Demonstrates:
 * - `createTableBuilder` with secure defaults (PITR, deletion protection)
 * - **Provisioned billing.** Setting `readCapacity`/`writeCapacity` makes the
 *   on-demand `billingMode` default yield (ADR-0009: a default drops when it is
 *   mutually exclusive with a sibling property the caller set). `billingMode`
 *   is set explicitly here too, for clarity.
 * - **Customer-managed KMS.** Passing `encryptionKey` makes the AWS-managed
 *   encryption default yield — the builder infers `CUSTOMER_MANAGED` from the
 *   key, so the key is the only property needed.
 * - Tuning a recommended alarm threshold via `recommendedAlarms`. Read
 *   throttling matters most on a provisioned table, where it signals
 *   under-provisioned capacity rather than a transient on-demand burst.
 * - Routing the table's alarms to an SNS topic via `alarmActionsPolicy`.
 */
export function createLedgerTableApp(app = new App()): { stack: Stack } {
  const stack = new Stack(app, "ComposureCDK-LedgerTableStack");

  // A customer-managed key gives the ledger an auditable, rotatable, account-
  // owned encryption boundary — stricter than the AWS-managed default.
  const ledgerKey = new Key(stack, "LedgerKey", {
    description: "CMK for the ComposureCDK ledger table",
    enableKeyRotation: true,
  });

  const { alerts } = compose(
    {
      alerts: createTopicBuilder().displayName("Ledger Table Alerts"),

      ledger: createTableBuilder()
        // Keyed by account, ordered by transaction id within the account.
        .partitionKey({ name: "accountId", type: AttributeType.STRING })
        .sortKey({ name: "txnId", type: AttributeType.STRING })
        // Steady, forecastable ledger throughput — provision capacity rather
        // than pay per request. Setting capacity makes the on-demand default
        // yield (ADR-0009); the explicit billingMode documents the intent.
        .billingMode(BillingMode.PROVISIONED)
        .readCapacity(5)
        .writeCapacity(5)
        // Customer-managed encryption — the builder infers CUSTOMER_MANAGED
        // from the key, so the AWS-managed default yields.
        .encryptionKey(ledgerKey)
        .recommendedAlarms({
          // On a provisioned table, read throttling means under-provisioned
          // read capacity — alert promptly.
          readThrottleEvents: { threshold: 1, evaluationPeriods: 2 },
        }),
    },
    { alerts: [], ledger: [] },
  ).build(stack, "Ledger");

  alarmActionsPolicy(stack, {
    defaults: { alarmActions: [new SnsAction(alerts.topic)] },
  });

  return { stack };
}
