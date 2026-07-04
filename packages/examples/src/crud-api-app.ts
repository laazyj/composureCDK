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

/** The two sibling outputs every `AwsIntegration` below needs: the table to
 * call and the role to call it as. */
interface TableAndRole {
  tableName: string;
  role: RoleBuilderResult["role"];
}

/**
 * A plain {@link Lifecycle} — not a builder — that does nothing but merge
 * the `table` and `apiRole` components' outputs into one object. `ref()`
 * only reaches a single named component, and each method below needs both,
 * so this is the one piece of glue standing between the two `Resolvable`s
 * and the resource tree; the DynamoDB action and VTL mapping for each verb
 * stays declared inline at its `addMethod` call, in `createCrudApiApp` below.
 */
function createTableAndRole(): Lifecycle<TableAndRole> {
  return {
    build(_scope: IConstruct, _id: string, context: Record<string, object> = {}) {
      const { table } = context.table as TableV2BuilderResult;
      const { role } = context.apiRole as RoleBuilderResult;
      return { tableName: table.tableName, role };
    },
  };
}

/** Builds the `AwsIntegration` for one DynamoDB action against the resolved
 * table + role, given the request/response VTL for that action. */
function dynamoIntegration(
  { role }: TableAndRole,
  action: DynamoAction,
  requestTemplate: object,
  responseTemplate: string,
): Integration {
  return new AwsIntegration({
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
}

/** A `ref` to the `tableAndRole` component, resolving straight to the
 * `AwsIntegration` for one DynamoDB action. */
function gadgetIntegration(
  action: DynamoAction,
  requestTemplate: (tableName: string) => object,
  responseTemplate: string,
) {
  return ref("tableAndRole", (tr: TableAndRole) =>
    dynamoIntegration(tr, action, requestTemplate(tr.tableName), responseTemplate),
  );
}

/**
 * The minimal REST-API-to-DynamoDB CRUD shape: API Gateway's `AwsIntegration`
 * calls the DynamoDB data-plane API directly through VTL request/response
 * mapping templates — no Lambda sits in the request path.
 *
 * Demonstrates:
 * - `createTableV2Builder`, keyed on `id`, as the item store.
 * - `createServiceRoleBuilder("apigateway.amazonaws.com")` for the role API
 *   Gateway assumes when calling DynamoDB, granted access via the table's own
 *   `.grantReadWriteData(ref("apiRole", ...))` — declared as data alongside
 *   the table's other configuration, and applied during the table's own
 *   `build()` once the role exists, rather than pushed out to an imperative
 *   post-build hook.
 * - `createRestApiBuilder` wiring each HTTP verb straight to a DynamoDB
 *   action (`Scan`, `PutItem`, `GetItem`, `DeleteItem`) via `gadgetIntegration`
 *   — the resource tree below is the full, literal description of the API:
 *   every path, verb, DynamoDB action, and mapping template is declared at
 *   its `addMethod` call, not hidden behind a helper that builds the API
 *   shape off-stage.
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
export function createCrudApiApp(app = new App()) {
  const stack = new Stack(app, "ComposureCDK-CrudApiStack");

  compose(
    {
      table: createTableV2Builder()
        .partitionKey({ name: "id", type: AttributeType.STRING })
        .grantReadWriteData(ref("apiRole", (r: RoleBuilderResult) => r.role)),

      apiRole: createServiceRoleBuilder("apigateway.amazonaws.com").description(
        "Assumed by API Gateway to call DynamoDB directly for the gadgets table",
      ),

      tableAndRole: createTableAndRole(),

      api: createRestApiBuilder()
        .restApiName("CrudApi")
        .description("Minimal REST API backed directly by DynamoDB — no Lambda in the request path")
        .addResource("gadgets", (gadgets) =>
          gadgets
            .addMethod(
              "GET",
              gadgetIntegration(
                "Scan",
                (tableName) => ({ TableName: tableName }),
                `{
  "gadgets": [
    #foreach($item in $input.path('$.Items'))
    { "id": "$item.id.S", "name": "$item.name.S", "description": "$item.description.S" }#if($foreach.hasNext),#end
    #end
  ]
}`,
              ),
              OK,
            )
            .addMethod(
              "POST",
              gadgetIntegration(
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
              ),
              OK,
            )
            .addResource("{id}", (gadget) =>
              gadget
                .addMethod(
                  "GET",
                  gadgetIntegration(
                    "GetItem",
                    (tableName) => ({
                      TableName: tableName,
                      Key: { id: { S: "$input.params('id')" } },
                    }),
                    `{
  "id": "$input.path('$.Item.id.S')",
  "name": "$input.path('$.Item.name.S')",
  "description": "$input.path('$.Item.description.S')"
}`,
                  ),
                  OK,
                )
                .addMethod(
                  "PUT",
                  gadgetIntegration(
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
                  ),
                  OK,
                )
                .addMethod(
                  "DELETE",
                  gadgetIntegration(
                    "DeleteItem",
                    (tableName) => ({
                      TableName: tableName,
                      Key: { id: { S: "$input.params('id')" } },
                    }),
                    `{ "id": "$input.params('id')", "deleted": true }`,
                  ),
                  OK,
                ),
            ),
        ),
    },
    {
      table: ["apiRole"],
      apiRole: [],
      tableAndRole: ["table", "apiRole"],
      api: ["tableAndRole"],
    },
  ).build(stack, "CrudApiApp");

  return { stack };
}
