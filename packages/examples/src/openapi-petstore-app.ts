import { App } from "aws-cdk-lib";
import { ApiDefinition } from "aws-cdk-lib/aws-apigateway";
import { compose } from "@composurecdk/core";
import { createSpecRestApiBuilder } from "@composurecdk/apigateway";
import { createStackBuilder } from "@composurecdk/cloudformation";

/**
 * An inline OpenAPI 3.0 specification for a PetStore API.
 *
 * Defines three endpoints with API Gateway mock integrations:
 * - `GET  /pets`        — list all pets
 * - `POST /pets`        — create a pet
 * - `GET  /pets/{petId}` — get a pet by ID
 */
const petstoreSpec = {
  openapi: "3.0.2",
  info: {
    title: "PetStore",
    version: "1.0",
  },
  paths: {
    "/pets": {
      get: {
        summary: "List all pets",
        operationId: "listPets",
        responses: {
          "200": {
            description: "A list of pets",
            content: {
              "application/json": {
                schema: {
                  type: "array",
                  items: { $ref: "#/components/schemas/Pet" },
                },
              },
            },
          },
        },
        "x-amazon-apigateway-integration": {
          type: "MOCK",
          requestTemplates: { "application/json": '{ "statusCode": 200 }' },
          responses: {
            default: {
              statusCode: "200",
              responseTemplates: {
                "application/json": JSON.stringify([
                  { id: 1, name: "Fido", tag: "dog" },
                  { id: 2, name: "Whiskers", tag: "cat" },
                ]),
              },
            },
          },
        },
      },
      post: {
        summary: "Create a pet",
        operationId: "createPet",
        responses: {
          "201": {
            description: "Pet created",
          },
        },
        "x-amazon-apigateway-integration": {
          type: "MOCK",
          requestTemplates: { "application/json": '{ "statusCode": 201 }' },
          responses: {
            default: {
              statusCode: "201",
              responseTemplates: {
                "application/json": JSON.stringify({ id: 3, name: "Buddy", tag: "dog" }),
              },
            },
          },
        },
      },
    },
    "/pets/{petId}": {
      get: {
        summary: "Get a pet by ID",
        operationId: "getPet",
        parameters: [
          {
            name: "petId",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "A single pet",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/Pet" },
              },
            },
          },
        },
        "x-amazon-apigateway-integration": {
          type: "MOCK",
          requestTemplates: { "application/json": '{ "statusCode": 200 }' },
          responses: {
            default: {
              statusCode: "200",
              responseTemplates: {
                "application/json": JSON.stringify({ id: 1, name: "Fido", tag: "dog" }),
              },
            },
          },
        },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["id", "name"],
        properties: {
          id: { type: "integer" },
          name: { type: "string" },
          tag: { type: "string" },
        },
      },
    },
  },
};

/**
 * A PetStore REST API defined by an inline OpenAPI 3.0 specification,
 * composed into a single stack.
 *
 * Demonstrates:
 * - Defining a REST API from an OpenAPI specification using SpecRestApiBuilder
 * - Inline OpenAPI definition with API Gateway mock integrations
 * - Schema components and `$ref` references
 * - Building the composed system into a CDK Stack
 *
 * Resource tree (defined in the OpenAPI spec):
 * ```
 * /
 * └── pets/
 *     ├── GET   → [{ id: 1, name: "Fido" }, ...]
 *     ├── POST  → { id: 3, name: "Buddy" }
 *     └── {petId}/
 *         └── GET → { id: 1, name: "Fido" }
 * ```
 */
export function createOpenApiPetstoreApp(app = new App()) {
  const { stack } = createStackBuilder()
    .description("A PetStore API defined by an OpenAPI specification")
    .build(app, "ComposureCDK-OpenApiPetstoreStack");

  compose(
    {
      api: createSpecRestApiBuilder()
        .restApiName("PetStore")
        .description("A PetStore API defined by an OpenAPI specification")
        .apiDefinition(ApiDefinition.fromInline(petstoreSpec)),
    },
    { api: [] },
  ).build(stack, "OpenApiPetstoreApp");

  return { stack };
}
