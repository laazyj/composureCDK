import { Aws } from "aws-cdk-lib";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { compose, ref } from "@composurecdk/core";
import { createSpecRestApiBuilder, inlineSpecDefinition } from "@composurecdk/apigateway";
import { createStackBuilder } from "@composurecdk/cloudformation";
import { createServiceRoleBuilder, type RoleBuilderResult } from "@composurecdk/iam";
import {
  createFunctionBuilder,
  functionGrants,
  type FunctionBuilderResult,
} from "@composurecdk/lambda";
import { exampleApp } from "./app-context.js";

/** The names the specification's integration refers its backend by — the shape
 * a model-first export takes, written before the infrastructure exists. */
const FUNCTION_ARN = "${GetPetFunction.Arn}";
const ROLE_ARN = "${ApiGatewayRole.Arn}";

/** The `GET /pets/{petId}` handler. Reports `source: "lambda"` so the smoke
 * test can tell a real invocation from the mock-integrated paths. */
const GET_PET_HANDLER = `exports.handler = async (event) => ({
  statusCode: 200,
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    id: event.pathParameters.petId,
    name: "Fido",
    tag: "dog",
    source: "lambda",
  }),
});`;

/**
 * An inline OpenAPI 3.0 specification for a PetStore API.
 *
 * Defines three endpoints:
 * - `GET  /pets`        — list all pets (mock integration)
 * - `POST /pets`        — create a pet (mock integration)
 * - `GET  /pets/{petId}` — get a pet by ID, served by a Lambda the document
 *   names only by placeholder
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
        // Backed by a Lambda whose ARN the document cannot know. `Aws.*` are
        // scope-free pseudo-parameters, so only the two ARNs are placeholders.
        "x-amazon-apigateway-integration": {
          type: "aws_proxy",
          httpMethod: "POST",
          uri: `arn:${Aws.PARTITION}:apigateway:${Aws.REGION}:lambda:path/2015-03-31/functions/${FUNCTION_ARN}/invocations`,
          credentials: ROLE_ARN,
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
 * A PetStore REST API defined by an inline OpenAPI 3.0 specification, with one
 * path served by a Lambda the specification names only by placeholder.
 *
 * This is the model-first shape: a document generated before the
 * infrastructure serving it exists, so its integration names the backend by
 * placeholder. Those ARNs are unknown while the builder is configured and
 * exist only once the siblings are built, so the definition is assembled by
 * `inlineSpecDefinition`, which resolves them first — keeping the whole system
 * in one `compose` call.
 *
 * Demonstrates:
 * - Defining a REST API from an OpenAPI specification using SpecRestApiBuilder
 * - A resolvable `apiDefinition`: the specification is completed at build time
 *   from sibling components, via `inlineSpecDefinition`
 * - An `aws_proxy` integration authorised by a credentials role, granted
 *   consumer-side with `functionGrants.invoke` (ADR-0013)
 * - Mock and Lambda-backed integrations side by side in one document
 * - Schema components and `$ref` references
 *
 * Resource tree (defined in the OpenAPI spec):
 * ```
 * /
 * └── pets/
 *     ├── GET   → [{ id: 1, name: "Fido" }, ...]   (mock)
 *     ├── POST  → { id: 3, name: "Buddy" }         (mock)
 *     └── {petId}/
 *         └── GET → { id, name: "Fido", … }        (Lambda, via aws_proxy)
 * ```
 */
export function createOpenApiPetstoreApp(app = exampleApp()) {
  const { stack } = createStackBuilder()
    .description("A PetStore API defined by an OpenAPI specification")
    .build(app, "ComposureCDK-OpenApiPetstoreStack");

  compose(
    {
      getPet: createFunctionBuilder()
        .runtime(Runtime.NODEJS_22_X)
        .handler("index.handler")
        .code(Code.fromInline(GET_PET_HANDLER)),

      // The role API Gateway assumes to invoke the handler. An ordinary
      // sibling — visible in the graph, granted from the grantee's side.
      apiGatewayRole: createServiceRoleBuilder("apigateway.amazonaws.com").grant(
        functionGrants.invoke(ref("getPet", (r: FunctionBuilderResult) => r.function)),
      ),

      api: createSpecRestApiBuilder()
        .restApiName("PetStore")
        .description("A PetStore API defined by an OpenAPI specification")
        .apiDefinition(
          inlineSpecDefinition(petstoreSpec, {
            [FUNCTION_ARN]: ref("getPet", (r: FunctionBuilderResult) => r.function.functionArn),
            [ROLE_ARN]: ref("apiGatewayRole", (r: RoleBuilderResult) => r.role.roleArn),
          }),
        ),
    },
    {
      getPet: [],
      apiGatewayRole: ["getPet"],
      api: ["getPet", "apiGatewayRole"],
    },
  ).build(stack, "OpenApiPetstoreApp");

  return { stack };
}
