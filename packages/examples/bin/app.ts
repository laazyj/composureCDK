#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { cleanDeskPolicy } from "../src/clean-desk-policy.js";
import { createDualFunctionApp } from "../src/dual-function-app.js";
import { createLambdaApiApp } from "../src/lambda-api-app.js";
import { createMockApiApp } from "../src/mock-api-app.js";
import { createMultiStackApp } from "../src/multi-stack-app.js";
import { createOpenApiPetstoreApp } from "../src/openapi-petstore-app.js";
import { createStaticWebsiteApp } from "../src/static-website/app.js";
import { createCustomDomainWebsiteApp } from "../src/custom-domain-website/app.js";
import { createStrategyStackApp } from "../src/strategy-stack-app.js";

const app = new App();
cleanDeskPolicy(app);

createDualFunctionApp(app);
createLambdaApiApp(app);
createMockApiApp(app);
createMultiStackApp(app);
createOpenApiPetstoreApp(app);
createStaticWebsiteApp(app);
// Opt-in: only synthesised when a pre-existing delegated hosted zone is
// supplied via COMPOSURECDK_DOMAIN or --context domain=...; see
// custom-domain-website/app.ts for the prerequisites.
const domainContext: unknown = app.node.tryGetContext("domain");
if (typeof domainContext === "string" || process.env.COMPOSURECDK_DOMAIN) {
  createCustomDomainWebsiteApp(app);
}
createStrategyStackApp(app);

app.synth();
