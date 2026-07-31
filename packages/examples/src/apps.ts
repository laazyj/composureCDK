import { App } from "aws-cdk-lib";
import { cleanDeskPolicy } from "./clean-desk-policy.js";
import { createAgentVolumeApp } from "./agent-volume-app.js";
import { createCrudApiApp } from "./crud-api-app.js";
import { createDnsZoneApp } from "./dns-zone-app.js";
import { createDualFunctionApp } from "./dual-function-app.js";
import { createDynamoStreamProcessorApp } from "./dynamo-stream-processor-app.js";
import { createEc2App } from "./ec2-app.js";
import { createMockApiApp } from "./mock-api-app.js";
import { createMultiStackApp } from "./multi-stack-app.js";
import { createNeptuneGraphApp } from "./neptune-graph-app.js";
import { createOpenApiPetstoreApp } from "./openapi-petstore-app.js";
import { createOrderProcessorApp } from "./order-processor-app.js";
import { createStaticWebsiteApp } from "./static-website/app.js";
import { createTaggedSystemApp } from "./tagged-system-app.js";

/**
 * Builds every example stack into one CDK app — the single registry of
 * examples, used both by the `bin/app.ts` entrypoint CI deploys and by the
 * tests that assert across all stacks at once. Register a new example here
 * and it is covered by both.
 */
export function buildExampleApp(app = new App()): App {
  cleanDeskPolicy(app);

  createAgentVolumeApp(app);
  createCrudApiApp(app);
  createDnsZoneApp(app);
  createDualFunctionApp(app);
  createDynamoStreamProcessorApp(app);
  createEc2App(app);
  createMockApiApp(app);
  createMultiStackApp(app);
  createNeptuneGraphApp(app);
  createOpenApiPetstoreApp(app);
  createOrderProcessorApp(app);
  createStaticWebsiteApp(app);
  createTaggedSystemApp(app);

  return app;
}
