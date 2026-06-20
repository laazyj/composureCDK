import {
  Billing,
  BillingMode,
  TableEncryption,
  TableEncryptionV2,
  type TableProps,
  type TablePropsV2,
} from "aws-cdk-lib/aws-dynamodb";

/**
 * Secure, AWS-recommended defaults applied to every DynamoDB table built
 * with {@link createTableBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 *
 * `partitionKey` is intentionally not defaulted — the key schema is the
 * single most workload-specific decision for a table and there is no safe
 * generic value. The builder requires it to be set before {@link Lifecycle.build}.
 */
export const TABLE_DEFAULTS: Partial<TableProps> = {
  /**
   * On-demand (pay-per-request) capacity. Removes the need to forecast and
   * provision read/write capacity, scales instantly with traffic, and avoids
   * throttling caused by under-provisioning — the safe default for variable
   * or unknown workloads. Switch to {@link BillingMode.PROVISIONED} with
   * `.readCapacity()` / `.writeCapacity()` for steady, predictable traffic
   * where provisioned capacity is more cost-effective.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/capacity.html
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
   */
  billingMode: BillingMode.PAY_PER_REQUEST,

  /**
   * Encrypt at rest with an AWS-managed KMS key (`aws/dynamodb`) rather than
   * the default AWS-owned key. The AWS-managed key is visible in the account's
   * KMS console and its use is logged in CloudTrail, giving an auditable record
   * of table encryption — what the Security Pillar asks for. Bring-your-own KMS
   * is opt-in: set `.encryptionKey(key)` and the builder infers
   * {@link TableEncryption.CUSTOMER_MANAGED}.
   *
   * Note: the AWS-managed key incurs KMS API request charges that the free,
   * AWS-owned key does not. Override with `.encryption(TableEncryption.DEFAULT)`
   * to fall back to the AWS-owned key.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-at-rest.html
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html
   */
  encryption: TableEncryption.AWS_MANAGED,

  /**
   * Enable point-in-time recovery (continuous backups). Lets the table be
   * restored to any second within the preceding 35 days, protecting against
   * accidental writes, deletes, and application-level corruption. The Reliability
   * Pillar treats automated, restorable backups as table stakes for stateful
   * services.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_backing_up_data_identified_backups_data.html
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html
   */
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },

  /**
   * Enable deletion protection so the table cannot be deleted by an API call,
   * console action, or `cdk destroy` until protection is explicitly turned off.
   * Guards production data against accidental teardown.
   *
   * This is intentionally heavier than CDK's default `RemovalPolicy.RETAIN`
   * (which only orphans the table from the stack): deletion protection blocks
   * the delete operation itself. Override with `.deletionProtection(false)` for
   * ephemeral or test tables you expect to tear down.
   *
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithTables.Basics.html#WorkingWithTables.Basics.DeletionProtection
   */
  deletionProtection: true,
};

/**
 * Secure, AWS-recommended defaults applied to every DynamoDB table built with
 * {@link createTableV2Builder}. These encode the same well-architected intent
 * as {@link TABLE_DEFAULTS} (on-demand billing, AWS-managed-KMS encryption,
 * point-in-time recovery, deletion protection) against the `TableV2`
 * (`AWS::DynamoDB::GlobalTable`) prop shape, where billing and encryption are
 * single helper objects rather than flat props.
 *
 * As with {@link TABLE_DEFAULTS}, `partitionKey` is intentionally not defaulted
 * — the key schema is the single most workload-specific decision for a table
 * and there is no safe generic value.
 */
export const TABLE_V2_DEFAULTS: Partial<TablePropsV2> = {
  /**
   * On-demand (pay-per-request) capacity. Removes the need to forecast and
   * provision read/write capacity, scales instantly with traffic, and avoids
   * throttling caused by under-provisioning — the safe default for variable or
   * unknown workloads. Switch to {@link Billing.provisioned} with
   * `MaxCapacity`/`Capacity.autoscaled(...)` for steady, predictable traffic
   * where provisioned capacity is more cost-effective.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/serverless-applications-lens/capacity.html
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html
   */
  billing: Billing.onDemand(),

  /**
   * Encrypt at rest with an AWS-managed KMS key (`aws/dynamodb`) rather than the
   * default AWS-owned key. The AWS-managed key is visible in the account's KMS
   * console and its use is logged in CloudTrail, giving an auditable record of
   * table encryption — what the Security Pillar asks for. Bring-your-own KMS is
   * opt-in via `.encryption(TableEncryptionV2.customerManagedKey(key))`.
   *
   * Note: the AWS-managed key incurs KMS API request charges that the free,
   * AWS-owned key does not. Override with
   * `.encryption(TableEncryptionV2.dynamoOwnedKey())` to fall back to the
   * AWS-owned key.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-at-rest.html
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/EncryptionAtRest.html
   */
  encryption: TableEncryptionV2.awsManagedKey(),

  /**
   * Enable point-in-time recovery (continuous backups). Lets the table be
   * restored to any second within the preceding 35 days, protecting against
   * accidental writes, deletes, and application-level corruption. The
   * Reliability Pillar treats automated, restorable backups as table stakes for
   * stateful services.
   *
   * Note: for `TableV2` (`AWS::DynamoDB::GlobalTable`) this setting is encoded
   * per-replica (`Replicas[].PointInTimeRecoverySpecification`), not at the
   * resource root — CDK applies it to each replica.
   *
   * @see https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_backing_up_data_identified_backups_data.html
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/PointInTimeRecovery.html
   */
  pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: true },

  /**
   * Enable deletion protection so the table cannot be deleted by an API call,
   * console action, or `cdk destroy` until protection is explicitly turned off.
   * Guards production data against accidental teardown. Override with
   * `.deletionProtection(false)` for ephemeral or test tables.
   *
   * Note: for `TableV2` (`AWS::DynamoDB::GlobalTable`) this setting is encoded
   * per-replica (`Replicas[].DeletionProtectionEnabled`), not at the resource
   * root — CDK applies it to each replica.
   *
   * @see https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/WorkingWithTables.Basics.html#WorkingWithTables.Basics.DeletionProtection
   */
  deletionProtection: true,
};
