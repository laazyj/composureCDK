import { ArnFormat, Stack } from "aws-cdk-lib";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { ResourcePolicy } from "aws-cdk-lib/aws-logs";
import {
  CfnTransactionSearchConfig,
  type CfnTransactionSearchConfigProps,
} from "aws-cdk-lib/aws-xray";
import type { IConstruct } from "constructs";
import { Builder, type IBuilder, type Lifecycle } from "@composurecdk/core";
import { TRANSACTION_SEARCH_DEFAULTS } from "./defaults.js";

/** Configuration properties for {@link createTransactionSearchBuilder}. */
export type TransactionSearchBuilderProps = CfnTransactionSearchConfigProps;

/** The build output of an {@link ITransactionSearchBuilder}. */
export interface TransactionSearchBuilderResult {
  transactionSearch: CfnTransactionSearchConfig;
  /** Lets X-Ray write spans to CloudWatch Logs. */
  resourcePolicy: ResourcePolicy;
}

/**
 * A fluent builder that enables CloudWatch Transaction Search.
 *
 * @see {@link createTransactionSearchBuilder}
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::XRay::TransactionSearchConfig has no Tags property
export type ITransactionSearchBuilder = IBuilder<
  TransactionSearchBuilderProps,
  TransactionSearchBuilder
>;

/** The log groups Transaction Search writes to. */
const SPAN_LOG_GROUPS = ["aws/spans", "/aws/application-signals/data"];

class TransactionSearchBuilder implements Lifecycle<TransactionSearchBuilderResult> {
  props: Partial<TransactionSearchBuilderProps> = {};

  build(scope: IConstruct, id: string): TransactionSearchBuilderResult {
    const stack = Stack.of(scope);
    const resourcePolicy = new ResourcePolicy(scope, `${id}LogsPolicy`, {
      policyStatements: [
        new PolicyStatement({
          sid: "TransactionSearchXRayAccess",
          principals: [new ServicePrincipal("xray.amazonaws.com")],
          actions: ["logs:PutLogEvents"],
          resources: SPAN_LOG_GROUPS.map((name) =>
            stack.formatArn({
              service: "logs",
              resource: "log-group",
              resourceName: `${name}:*`,
              arnFormat: ArnFormat.COLON_RESOURCE_NAME,
            }),
          ),
          conditions: {
            ArnLike: {
              "aws:SourceArn": stack.formatArn({
                service: "xray",
                resource: "*",
                arnFormat: ArnFormat.NO_RESOURCE_NAME,
              }),
            },
            StringEquals: { "aws:SourceAccount": stack.account },
          },
        }),
      ],
    });
    const transactionSearch = new CfnTransactionSearchConfig(scope, id, {
      ...TRANSACTION_SEARCH_DEFAULTS,
      ...this.props,
    });
    transactionSearch.node.addDependency(resourcePolicy);
    return { transactionSearch, resourcePolicy };
  }
}

/**
 * Creates a builder that enables CloudWatch Transaction Search for the account
 * and Region. Build it in exactly one stack.
 *
 * @example
 * ```ts
 * createTransactionSearchBuilder().build(stack, "TransactionSearch");
 * ```
 *
 * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Enable-TransactionSearch.html
 */
export function createTransactionSearchBuilder(): ITransactionSearchBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::XRay::TransactionSearchConfig has no Tags property
  return Builder<TransactionSearchBuilderProps, TransactionSearchBuilder>(TransactionSearchBuilder);
}
