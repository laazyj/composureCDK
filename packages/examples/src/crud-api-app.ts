import { App, Stack } from "aws-cdk-lib";
import {
  AwsIntegration,
  PassthroughBehavior,
  type MethodOptions,
} from "aws-cdk-lib/aws-apigateway";
import { AttributeType } from "aws-cdk-lib/aws-dynamodb";
import { compose, combine, ref } from "@composurecdk/core";
import { createRestApiBuilder } from "@composurecdk/apigateway";
import {
  createTableV2Builder,
  tableGrants,
  type TableV2BuilderResult,
} from "@composurecdk/dynamodb";
import { createServiceRoleBuilder, type RoleBuilderResult } from "@composurecdk/iam";

/** Every method here returns a bare `200` — no error mapping. A production
 * API would add `selectionPattern` integration responses (e.g. matching
 * DynamoDB's `ConditionalCheckFailedException`) to translate backend
 * failures into 4xx/5xx status codes. */
const OK: MethodOptions = { methodResponses: [{ statusCode: "200" }] };

type DynamoAction = "GetItem" | "PutItem" | "DeleteItem" | "Scan";

/**
 * A single `Ref` to the `AwsIntegration` for one DynamoDB action, assembled
 * from the two siblings it needs at once — the `table` to call (its name is
 * interpolated into the VTL request template) and the `apiRole` to call it
 * as. {@link combine} merges both into one `Ref` (ADR-0015); a plain `ref`
 * reaches only a single component. The DynamoDB action and VTL mapping for
 * each verb stays declared inline at its `addMethod` call, in
 * `createCrudApiApp` below.
 */
function gadgetIntegration(
  action: DynamoAction,
  requestTemplate: (tableName: string) => object,
  responseTemplate: string,
) {
  return combine(
    {
      tableName: ref("table", (r: TableV2BuilderResult) => r.table.tableName),
      role: ref("apiRole", (r: RoleBuilderResult) => r.role),
    },
    ({ tableName, role }) =>
      new AwsIntegration({
        service: "dynamodb",
        action,
        options: {
          credentialsRole: role,
          requestTemplates: { "application/json": JSON.stringify(requestTemplate(tableName)) },
          // Reject a request whose Content-Type has no matching request
          // template with a 415, rather than passing its unmapped body straight
          // to DynamoDB (the WHEN_NO_MATCH default) and masking the failure as
          // a 200 via the response template below.
          passthroughBehavior: PassthroughBehavior.NEVER,
          integrationResponses: [
            { statusCode: "200", responseTemplates: { "application/json": responseTemplate } },
          ],
        },
      }),
  );
}

const LIST_OPERATION = gadgetIntegration(
  "Scan",
  (tableName) => ({ TableName: tableName }),
  `{
  "gadgets": [
    #foreach($item in $input.path('$.Items'))
    { "id": "$item.id.S", "name": "$item.name.S", "description": "$item.description.S" }#if($foreach.hasNext),#end
    #end
  ]
}`,
);

const CREATE_OPERATION = gadgetIntegration(
  "PutItem",
  (tableName) => ({
    TableName: tableName,
    Item: {
      id: { S: "$context.requestId" },
      name: { S: "$input.path('$.name')" },
      description: { S: "$input.path('$.description')" },
    },
  }),
  `{ "id": "$context.requestId" }`,
);

const READ_OPERATION = gadgetIntegration(
  "GetItem",
  (tableName) => ({
    TableName: tableName,
    Key: { id: { S: "$input.params('id')" } },
    ConsistentRead: true,
  }),
  `{
  "id": "$input.path('$.Item.id.S')",
  "name": "$input.path('$.Item.name.S')",
  "description": "$input.path('$.Item.description.S')"
}`,
);

const UPDATE_OPERATION = gadgetIntegration(
  "PutItem",
  (tableName) => ({
    TableName: tableName,
    Item: {
      id: { S: "$input.params('id')" },
      name: { S: "$input.path('$.name')" },
      description: { S: "$input.path('$.description')" },
    },
  }),
  `{ "id": "$input.params('id')", "updated": true }`,
);

const DELETE_OPERATION = gadgetIntegration(
  "DeleteItem",
  (tableName) => ({
    TableName: tableName,
    Key: { id: { S: "$input.params('id')" } },
  }),
  `{ "id": "$input.params('id')", "deleted": true }`,
);

/**
 * A minimal CRUD REST API backed directly by DynamoDB — no Lambda in the
 * request path. Each HTTP verb is wired straight to a DynamoDB action via
 * `AwsIntegration` and a VTL mapping template:
 *
 * - `GET  /gadgets`      → `Scan`
 * - `POST /gadgets`      → `PutItem`
 * - `GET  /gadgets/{id}` → `GetItem`
 * - `PUT  /gadgets/{id}` → `PutItem`
 * - `DELETE /gadgets/{id}` → `DeleteItem`
 *
 * The role API Gateway assumes to call DynamoDB is an explicit
 * `createServiceRoleBuilder("apigateway.amazonaws.com")` sibling, granted
 * read/write access with a consumer-side grant (ADR-0013):
 * `apiRole.grant(tableGrants.readWrite(ref("table", …)))`. The grant edge
 * runs from the role (the consumer) to the table, matching the data flow —
 * no reverse edge, no cycle.
 */
export function createCrudApiApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-CrudApiStack");

  compose(
    {
      table: createTableV2Builder().partitionKey({ name: "id", type: AttributeType.STRING }),

      apiRole: createServiceRoleBuilder("apigateway.amazonaws.com")
        .description("Assumed by API Gateway to call DynamoDB directly for the gadgets table")
        .grant(tableGrants.readWrite(ref("table", (r: TableV2BuilderResult) => r.table))),

      api: createRestApiBuilder()
        .restApiName("CrudApi")
        .description("Minimal REST API backed directly by DynamoDB — no Lambda in the request path")
        .addResource("gadgets", (gadgets) =>
          gadgets
            .addMethod("GET", LIST_OPERATION, OK)
            .addMethod("POST", CREATE_OPERATION, OK)
            .addResource("{id}", (gadget) =>
              gadget
                .addMethod("GET", READ_OPERATION, OK)
                .addMethod("PUT", UPDATE_OPERATION, OK)
                .addMethod("DELETE", DELETE_OPERATION, OK),
            ),
        ),
    },
    {
      table: [],
      apiRole: ["table"],
      api: ["table", "apiRole"],
    },
  ).build(stack, "CrudApiApp");

  return { stack };
}
