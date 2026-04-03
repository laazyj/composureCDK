#!/usr/bin/env node
import { App } from "aws-cdk-lib";
import { cleanDeskPolicy } from "../src/clean-desk-policy.js";
import { createDualFunctionApp } from "../src/dual-function-app.js";
import { createLambdaApiApp } from "../src/lambda-api-app.js";
import { createMockApiApp } from "../src/mock-api-app.js";
import { createMultiStackApp } from "../src/multi-stack-app.js";
import { createStrategyStackApp } from "../src/strategy-stack-app.js";

const app = new App();
cleanDeskPolicy(app);

createDualFunctionApp(app);
createLambdaApiApp(app);
createMockApiApp(app);
createMultiStackApp(app);
createStrategyStackApp(app);

app.synth();
