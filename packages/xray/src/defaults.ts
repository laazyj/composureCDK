import type { CfnTransactionSearchConfigProps } from "aws-cdk-lib/aws-xray";

/**
 * Defaults applied by {@link createTransactionSearchBuilder}. Each can be
 * overridden through the builder.
 */
export const TRANSACTION_SEARCH_DEFAULTS: Partial<CfnTransactionSearchConfigProps> = {
  /**
   * Index 1% of spans as trace summaries: free, and AWS's default. Every span
   * is still ingested and searchable.
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Enable-TransactionSearch.html
   */
  indexingPercentage: 1,
};
