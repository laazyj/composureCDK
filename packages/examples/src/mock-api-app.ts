import { App, Stack } from "aws-cdk-lib";
import {
  type Integration,
  type MethodOptions,
  MockIntegration,
  PassthroughBehavior,
} from "aws-cdk-lib/aws-apigateway";
import { compose } from "@composurecdk/core";
import { createRestApiBuilder } from "@composurecdk/apigateway";

function jsonMock(statusCode: string, body: Record<string, unknown>): [Integration, MethodOptions] {
  return [
    new MockIntegration({
      integrationResponses: [
        {
          statusCode,
          responseTemplates: { "application/json": JSON.stringify(body) },
        },
      ],
      passthroughBehavior: PassthroughBehavior.NEVER,
      requestTemplates: { "application/json": `{ "statusCode": ${statusCode} }` },
    }),
    { methodResponses: [{ statusCode }] },
  ];
}

/**
 * A mock REST API demonstrating a typical CRUD resource tree,
 * composed into a single stack.
 *
 * Demonstrates:
 * - Defining a resource tree with nested paths
 * - Multiple HTTP methods per resource
 * - Mock integrations returning static JSON responses
 * - Building the composed system into a CDK Stack
 *
 * Resource tree:
 * ```
 * /
 * ├── GET          → { "service": "mock-api", "status": "healthy" }
 * └── users/
 *     ├── GET      → { "users": [...] }
 *     ├── POST     → { "id": "new-user-123" }
 *     └── {id}/
 *         ├── GET    → { "id": "123", "name": "Alice" }
 *         ├── PUT    → { "id": "123", "updated": true }
 *         └── DELETE  → { "id": "123", "deleted": true }
 * ```
 */
export function createMockApiApp() {
  const app = new App();
  const stack = new Stack(app, "MockApiStack");

  compose(
    {
      api: createRestApiBuilder()
        .restApiName("MockApi")
        .description("A mock CRUD API for demonstration")
        .addMethod("GET", ...jsonMock("200", { service: "mock-api", status: "healthy" }))
        .addResource("users", (users) =>
          users
            .addMethod(
              "GET",
              ...jsonMock("200", {
                users: [
                  { id: "1", name: "Alice" },
                  { id: "2", name: "Bob" },
                ],
              }),
            )
            .addMethod("POST", ...jsonMock("201", { id: "new-user-123" }))
            .addResource("{id}", (user) =>
              user
                .addMethod("GET", ...jsonMock("200", { id: "123", name: "Alice" }))
                .addMethod("PUT", ...jsonMock("200", { id: "123", updated: true }))
                .addMethod("DELETE", ...jsonMock("200", { id: "123", deleted: true })),
            ),
        ),
    },
    { api: [] },
  ).build(stack, "MockApiApp");

  return { stack };
}
