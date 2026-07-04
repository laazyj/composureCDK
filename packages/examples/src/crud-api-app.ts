import { App, Stack } from "aws-cdk-lib";
import { AwsIntegration, type Integration, type MethodOptions } from "aws-cdk-lib/aws-apigateway";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import type { IConstruct } from "constructs";
import { compose, ref, type Lifecycle } from "@composurecdk/core";
import { createRestApiBuilder } from "@composurecdk/apigateway";
import { createTableV2Builder, type TableV2BuilderResult } from "@composurecdk/dynamodb";
import { createServiceRoleBuilder, type RoleBuilderResult } from "@composurecdk/iam";

/** Every method here returns a bare `200` — no error mapping. A production
 * API would add `selectionPattern` integration responses (e.g. matching
 * DynamoDB's `ConditionalCheckFailedException`) to translate backend
 * failures into 4xx/5xx status codes. */
const OK: MethodOptions = { methodResponses: [{ statusCode: "200" }] };

type DynamoAction = "GetItem" | "PutItem" | "DeleteItem" | "Scan";

interface GadgetIntegrationsResult {
  list: Integration;
  create: Integration;
  read: Integration;
  update: Integration;
  remove: Integration;
}

/**
 * A plain {@link Lifecycle} — not a builder — that turns its two
 * dependencies' build outputs (the table and the role) into the five
 * `AwsIntegration`s the resource tree below wires up. Keeping this as its
 * own component lets `compose` resolve `table` and `apiRole` before it
 * runs, so the VTL mapping templates below can embed the table's physical
 * name directly instead of threading two separate `ref()`s through every
 * `addMethod` call.
 */
function createGadgetIntegrations(): Lifecycle<GadgetIntegrationsResult> {
  return {
    build(_scope: IConstruct, _id: string, context: Record<string, object> = {}) {
      const { table } = context.table as TableV2BuilderResult;
      const { role } = context.apiRole as RoleBuilderResult;
      const tableName = table.tableName;

      const integration = (
        action: DynamoAction,
        requestTemplate: object,
        responseTemplate: string,
      ): Integration =>
        new AwsIntegration({
          service: "dynamodb",
          action,
          options: {
            credentialsRole: role,
            requestTemplates: { "application/json": JSON.stringify(requestTemplate) },
            integrationResponses: [
              { statusCode: "200", responseTemplates: { "application/json": responseTemplate } },
            ],
          },
        });

      return {
        list: integration(
          "Scan",
          { TableName: tableName },
          `{
  "gadgets": [
    #foreach($item in $input.path('$.Items'))
    { "id": "$item.id.S", "name": "$item.name.S", "description": "$item.description.S" }#if($foreach.hasNext),#end
    #end
  ]
}`,
        ),

        create: integration(
          "PutItem",
          {
            TableName: tableName,
            Item: {
              id: { S: "$context.requestId" },
              name: { S: "$input.path('$.name')" },
              description: { S: "$input.path('$.description')" },
            },
          },
          `{ "id": "$context.requestId" }`,
        ),

        read: integration(
          "GetItem",
          { TableName: tableName, Key: { id: { S: "$input.params('id')" } } },
          `{
  "id": "$input.path('$.Item.id.S')",
  "name": "$input.path('$.Item.name.S')",
  "description": "$input.path('$.Item.description.S')"
}`,
        ),

        update: integration(
          "PutItem",
          {
            TableName: tableName,
            Item: {
              id: { S: "$input.params('id')" },
              name: { S: "$input.path('$.name')" },
              description: { S: "$input.path('$.description')" },
            },
          },
          `{ "id": "$input.params('id')", "updated": true }`,
        ),

        remove: integration(
          "DeleteItem",
          { TableName: tableName, Key: { id: { S: "$input.params('id')" } } },
          `{ "id": "$input.params('id')", "deleted": true }`,
        ),
      };
    },
  };
}

/**
 * The minimal REST-API-to-DynamoDB CRUD shape: API Gateway's `AwsIntegration`
 * calls the DynamoDB data-plane API directly through VTL request/response
 * mapping templates — no Lambda sits in the request path.
 *
 * Demonstrates:
 * - `createTableV2Builder`, keyed on `id`, as the item store.
 * - `createServiceRoleBuilder("apigateway.amazonaws.com")` for the role API
 *   Gateway assumes when calling DynamoDB, granted access via
 *   `table.grantReadWriteData(role)` in an `afterBuild` hook — the grant
 *   runs once both constructs exist, producing a policy scoped to this
 *   table's ARN rather than a hand-written wildcard statement.
 * - `createRestApiBuilder` wiring each HTTP verb straight to a DynamoDB
 *   action (`Scan`, `PutItem`, `GetItem`, `DeleteItem`) via the
 *   `gadgetIntegrations` component, referenced with `ref` so the resource
 *   tree only depends on the *result* of the table + role composition.
 *
 * Resource tree (a "gadget" catalog — the business domain is arbitrary):
 * ```
 * /gadgets
 * ├── GET     → Scan, returns { "gadgets": [...] }
 * ├── POST    → PutItem, id generated from $context.requestId
 * └── {id}/
 *     ├── GET    → GetItem
 *     ├── PUT    → PutItem, full replace
 *     └── DELETE → DeleteItem
 * ```
 */
/** A `ref` to one named integration built by the `gadgetIntegrations` component. */
function gadgetIntegration(key: keyof GadgetIntegrationsResult) {
  return ref("gadgetIntegrations", (r: GadgetIntegrationsResult) => r[key]);
}

export function createCrudApiApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-CrudApiStack");

  compose(
    {
      table: createTableV2Builder().partitionKey({ name: "id", type: AttributeType.STRING }),

      apiRole: createServiceRoleBuilder("apigateway.amazonaws.com").description(
        "Assumed by API Gateway to call DynamoDB directly for the gadgets table",
      ),

      gadgetIntegrations: createGadgetIntegrations(),

      api: createRestApiBuilder()
        .restApiName("CrudApi")
        .description("Minimal REST API backed directly by DynamoDB — no Lambda in the request path")
        .addResource("gadgets", (gadgets) =>
          gadgets
            .addMethod("GET", gadgetIntegration("list"), OK)
            .addMethod("POST", gadgetIntegration("create"), OK)
            .addResource("{id}", (gadget) =>
              gadget
                .addMethod("GET", gadgetIntegration("read"), OK)
                .addMethod("PUT", gadgetIntegration("update"), OK)
                .addMethod("DELETE", gadgetIntegration("remove"), OK),
            ),
        ),
    },
    {
      table: [],
      apiRole: [],
      gadgetIntegrations: ["table", "apiRole"],
      api: ["gadgetIntegrations"],
    },
  )
    .afterBuild((_scope, _id, results) => {
      // Least-privilege grant scoped to this table's ARN, computed after
      // both constructs exist rather than authored as a hand-written policy.
      results.table.table.grantReadWriteData(results.apiRole.role);
    })
    .build(stack, "CrudApiApp");

  return { stack };
}
