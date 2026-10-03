import { Duration, Stack } from "aws-cdk-lib";
import { AttributeType, type ITableV2 } from "aws-cdk-lib/aws-dynamodb";
import { RuleTargetInput } from "aws-cdk-lib/aws-events";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { JsonPath, Succeed } from "aws-cdk-lib/aws-stepfunctions";
import {
  DynamoAttributeValue,
  DynamoPutItem,
  LambdaInvoke,
} from "aws-cdk-lib/aws-stepfunctions-tasks";
import type { Construct } from "constructs";
import { combine, compose, ref } from "@composurecdk/core";
import { createTableV2Builder, type TableV2BuilderResult } from "@composurecdk/dynamodb";
import { createRuleBuilder, sfnStateMachineTarget } from "@composurecdk/events";
import { createFunctionBuilder, type FunctionBuilderResult } from "@composurecdk/lambda";
import {
  createStateMachineBuilder,
  type StateMachineBuilderResult,
} from "@composurecdk/stepfunctions";
import { exampleApp } from "./app-context.js";

/**
 * The `source` every `OrderPlaced` event carries. The smoke test publishes as it,
 * and the deploy-test role may publish only as it.
 */
const ORDER_EVENT_SOURCE = "composurecdk.examples.orders";

/**
 * Most units of one SKU the stock check will reserve. Larger orders are
 * rejected — the business outcome the workflow's `Catch` handles.
 */
const STOCK_LIMIT = 10;

/** Records an order's outcome straight to DynamoDB — a direct SDK integration, no Lambda. */
function recordStatus(scope: Construct, id: string, orders: ITableV2, status: string) {
  return new DynamoPutItem(scope, id, {
    table: orders,
    item: {
      orderId: DynamoAttributeValue.fromString(JsonPath.stringAt("$.orderId")),
      status: DynamoAttributeValue.fromString(status),
    },
    resultPath: JsonPath.DISCARD,
  });
}

/**
 * Order fulfilment as a Step Functions workflow. An `OrderPlaced` event on the
 * default bus starts a Standard execution, which reserves stock through a
 * Lambda and records the outcome in DynamoDB. Both are siblings the definition
 * reaches through `combine`.
 *
 * Running out of stock is a business outcome, not a fault: a `Catch` records
 * the order `REJECTED` and the execution **succeeds**, so the recommended
 * `executionsFailed` alarm keeps meaning "something is broken".
 */
export function createFulfilmentWorkflowApp(app = exampleApp()) {
  const stack = new Stack(app, "ComposureCDK-FulfilmentWorkflowStack");

  compose(
    {
      orders: createTableV2Builder().partitionKey({
        name: "orderId",
        type: AttributeType.STRING,
      }),

      checkStock: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(
          Code.fromInline(
            `exports.handler = async (order) => {
  if (order.quantity > ${String(STOCK_LIMIT)}) {
    const error = new Error("Only ${String(STOCK_LIMIT)} of " + order.sku + " in stock");
    error.name = "OutOfStock";
    throw error;
  }
  return { reserved: order.quantity };
};`,
          ),
        )
        .timeout(Duration.seconds(10))
        .description("Reserves stock for an order; throws OutOfStock past the limit"),

      fulfilment: createStateMachineBuilder()
        .timeout(Duration.minutes(5))
        .definition(
          combine(
            {
              checkStock: ref<FunctionBuilderResult>("checkStock").get("function"),
              orders: ref<TableV2BuilderResult>("orders").get("table"),
            },
            ({ checkStock, orders }) =>
              (scope: Construct) =>
                new LambdaInvoke(scope, "CheckStock", {
                  lambdaFunction: checkStock,
                  resultPath: "$.stock",
                })
                  .addCatch(
                    recordStatus(scope, "RecordRejected", orders, "REJECTED").next(
                      new Succeed(scope, "Rejected"),
                    ),
                    { errors: ["OutOfStock"], resultPath: "$.error" },
                  )
                  .next(recordStatus(scope, "RecordAccepted", orders, "ACCEPTED"))
                  .next(new Succeed(scope, "Accepted")),
          ),
        ),

      orderPlaced: createRuleBuilder()
        .description("Starts fulfilment for each placed order")
        .eventPattern({ source: [ORDER_EVENT_SOURCE], detailType: ["OrderPlaced"] })
        .addTarget(
          "fulfilment",
          sfnStateMachineTarget(ref<StateMachineBuilderResult>("fulfilment").get("stateMachine"), {
            input: RuleTargetInput.fromEventPath("$.detail"),
          }),
        ),
    },
    {
      orders: [],
      checkStock: [],
      fulfilment: ["orders", "checkStock"],
      orderPlaced: ["fulfilment"],
    },
  ).build(stack, "FulfilmentWorkflow");

  return { stack };
}
