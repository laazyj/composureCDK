// Proves the Lambda-backed path of the spec-driven PetStore API works against
// live AWS: that the placeholders in the OpenAPI document were substituted with
// the real function ARN, and that the credentials role API Gateway assumes
// carries the invoke permission its consumer-side grant asked for.
// api-endpoints.smoke.mjs only checks that GET /pets (a mock integration)
// responds, which proves neither.

import { findRestApi, jsonRequest, pollUntil, restApiUrl } from "./_helpers.mjs";

export default {
  name: "OpenAPI PetStore Lambda integration",
  run: async ({ aws, region, pass, fail }) => {
    const api = findRestApi(aws, "PetStore");
    if (!api) {
      fail("PetStore REST API not found");
      return;
    }

    const url = restApiUrl(api, region, "/pets/42");
    let pet;
    let lastError;

    // The credentials role is minutes old on a fresh deploy, and IAM
    // propagation answers 500 in a way indistinguishable from the real failure
    // this check exists to catch. Retry briefly, then report the last body.
    const answered = await pollUntil(async () => {
      try {
        pet = await jsonRequest(url);
        return true;
      } catch (err) {
        lastError = err;
        return false;
      }
    });

    if (!answered) {
      // A 500 here is the interesting failure: the integration resolved to a
      // URI API Gateway could not invoke, or the role lacks the invoke
      // permission.
      fail(lastError.message);
      return;
    }

    if (pet.source !== "lambda" || pet.id !== "42") {
      fail(`GET ${url} — expected the handler's response for pet 42, got ${JSON.stringify(pet)}`);
      return;
    }

    pass(`GET ${url} — served by Lambda for pet ${pet.id}`);
  },
};
