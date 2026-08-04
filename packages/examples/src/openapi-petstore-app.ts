import { App, Aws } from "aws-cdk-lib";
import { ApiDefinition } from "aws-cdk-lib/aws-apigateway";
import { Code, Runtime } from "aws-cdk-lib/aws-lambda";
import { combine, compose, ref } from "@composurecdk/core";
import { createSpecRestApiBuilder } from "@composurecdk/apigateway";
import { createStackBuilder } from "@composurecdk/cloudformation";
import { createServiceRoleBuilder, type RoleBuilderResult } from "@composurecdk/iam";
import {
  createFunctionBuilder,
  functionGrants,
  type FunctionBuilderResult,
} from "@composurecdk/lambda";

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
 * Substitutes the resources the specification names by placeholder with the
 * concrete ARNs of the components that now serve it, returning a new document.
 *
 * An ordinary function of its inputs — no CDK scope, no builder — which is why
 * the substitution lives here rather than inside the builder.
 */
function withIntegration(spec: object, arns: Record<string, string>): object {
  const substituted = Object.entries(arns).reduce(
    (doc, [placeholder, arn]) => doc.split(placeholder).join(arn),
    JSON.stringify(spec),
  );

  return JSON.parse(substituted) as object;
}

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
 * exist only once the siblings are built, so the definition is passed as a
 * `combine` that resolves after them — keeping the whole system in one
 * `compose` call.
 *
 * Demonstrates:
 * - Defining a REST API from an OpenAPI specification using SpecRestApiBuilder
 * - A resolvable `apiDefinition`: the specification is completed at build time
 *   from sibling components, via `combine` (ADR-0015)
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
export function createOpenApiPetstoreApp(app = new App()) {
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
          combine(
            {
              getPet: ref<FunctionBuilderResult>("getPet"),
              apiGatewayRole: ref<RoleBuilderResult>("apiGatewayRole"),
            },
            ({ getPet, apiGatewayRole }) =>
              ApiDefinition.fromInline(
                withIntegration(petstoreSpec, {
                  [FUNCTION_ARN]: getPet.function.functionArn,
                  [ROLE_ARN]: apiGatewayRole.role.roleArn,
                }),
              ),
          ),
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
