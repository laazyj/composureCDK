// Exercises the full gadget lifecycle end-to-end, proving the API Gateway ->
// DynamoDB `AwsIntegration` wiring (and the role's consumer-side tableGrants)
// work against live AWS, not just that the endpoint responds. api-endpoints.smoke.mjs
// only checks a single path per API — this stack's runtime surface is the
// CRUD flow itself, so it gets a dedicated smoke test.

import { findRestApi, jsonRequest, restApiUrl } from "./_helpers.mjs";

export default {
  name: "CRUD API gadget lifecycle",
  run: async ({ aws, region, pass, fail }) => {
    const api = findRestApi(aws, "CrudApi");
    if (!api) {
      fail("CrudApi REST API not found");
      return;
    }

    const base = restApiUrl(api, region, "/gadgets");
    const marker = `smoke-${process.pid}-${Date.now()}`;

    // The catalogue the stack seeded through this API during deployment, via
    // `.invokeOnDeploy()`. Reading it back proves the deploy-time invocation
    // actually ran and actually reached the API — a green deploy alone only
    // proves the trigger did not report failure.
    try {
      const { gadgets } = await jsonRequest(base);
      const seeded = (gadgets ?? []).filter((g) =>
        g.description?.includes("seeded at deploy time"),
      );
      const names = new Set(seeded.map((g) => g.name));

      if (!names.has("widget") || !names.has("sprocket")) {
        fail(
          `GET ${base} — deploy-time seed missing; found ${JSON.stringify([...names])} among ${(gadgets ?? []).length} gadgets`,
        );
        return;
      }
      pass(`GET ${base} — deploy-time seed present (${seeded.length} reference gadgets)`);
    } catch (err) {
      fail(`${base} — reading the deploy-time seed: ${err.message}`);
      return;
    }

    try {
      const created = await jsonRequest(base, {
        method: "POST",
        body: { name: marker, description: "created by smoke test" },
      });
      if (!created.id) {
        fail(`POST ${base} — no id in response: ${JSON.stringify(created)}`);
        return;
      }
      pass(`POST ${base} — created ${created.id}`);

      const itemUrl = `${base}/${created.id}`;

      const read = await jsonRequest(itemUrl);
      if (read.name !== marker) {
        fail(`GET ${itemUrl} — expected name "${marker}", got ${JSON.stringify(read)}`);
        return;
      }
      pass(`GET ${itemUrl} — read back the created gadget`);

      await jsonRequest(itemUrl, {
        method: "PUT",
        body: { name: marker, description: "updated by smoke test" },
      });
      const updated = await jsonRequest(itemUrl);
      if (updated.description !== "updated by smoke test") {
        fail(`PUT ${itemUrl} — update did not persist: ${JSON.stringify(updated)}`);
        return;
      }
      pass(`PUT ${itemUrl} — update persisted`);

      const del = await fetch(itemUrl, { method: "DELETE" });
      if (!del.ok) {
        fail(`DELETE ${itemUrl} — ${del.status} ${del.statusText}`);
        return;
      }
      pass(`DELETE ${itemUrl} — ${del.status}`);
    } catch (err) {
      fail(`${base} — ${err.message}`);
    }
  },
};
