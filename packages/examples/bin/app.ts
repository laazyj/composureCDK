#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { cleanDeskPolicy } from "../src/clean-desk-policy.js";
import { createAgentVolumeApp } from "../src/agent-volume-app.js";
import { createDnsZoneApp } from "../src/dns-zone-app.js";
import { createDualFunctionApp } from "../src/dual-function-app.js";
import { createEc2App } from "../src/ec2-app.js";
import { createMockApiApp } from "../src/mock-api-app.js";
import { createMultiStackApp } from "../src/multi-stack-app.js";
import { createNeptuneGraphApp } from "../src/neptune-graph-app.js";
import { createOpenApiPetstoreApp } from "../src/openapi-petstore-app.js";
import { createOrderProcessorApp } from "../src/order-processor-app.js";
import { createStaticWebsiteApp } from "../src/static-website/app.js";
import { createTaggedSystemApp } from "../src/tagged-system-app.js";

const app = new App();
cleanDeskPolicy(app);

createAgentVolumeApp(app);
createDnsZoneApp(app);
createDualFunctionApp(app);
createEc2App(app);
createMockApiApp(app);
createMultiStackApp(app);
createNeptuneGraphApp(app);
createOpenApiPetstoreApp(app);
createOrderProcessorApp(app);
createStaticWebsiteApp(app);
createTaggedSystemApp(app);

app.synth();
