// Exercises the full gadget lifecycle end-to-end, proving the API Gateway ->
// DynamoDB `AwsIntegration` wiring (and the role's consumer-side tableGrants)
// work against live AWS, not just that the endpoint responds. api-endpoints.smoke.mjs
// only checks a single path per API — this stack's runtime surface is the
// CRUD flow itself, so it gets a dedicated smoke test. It also checks the web
// ACL in front of the API turns away a request that names no client.

import { findRestApi, jsonRequest, pollUntil, restApiUrl } from "./_helpers.mjs";

// Every request names its client: the web ACL in front of the API blocks one
// without this header (CLIENT_ID_HEADER in src/crud-api-app.ts).
const HEADER = "x-client-id";
const CLIENT = { [HEADER]: "smoke-test" };
const request = (url, options = {}) => jsonRequest(url, { ...options, headers: CLIENT });

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
      const { gadgets } = await request(base);
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
      const created = await request(base, {
        method: "POST",
        body: { name: marker, description: "created by smoke test" },
      });
      if (!created.id) {
        fail(`POST ${base} — no id in response: ${JSON.stringify(created)}`);
        return;
      }
      pass(`POST ${base} — created ${created.id}`);

      const itemUrl = `${base}/${created.id}`;

      const read = await request(itemUrl);
      if (read.name !== marker) {
        fail(`GET ${itemUrl} — expected name "${marker}", got ${JSON.stringify(read)}`);
        return;
      }
      pass(`GET ${itemUrl} — read back the created gadget`);

      await request(itemUrl, {
        method: "PUT",
        body: { name: marker, description: "updated by smoke test" },
      });
      const updated = await request(itemUrl);
      if (updated.description !== "updated by smoke test") {
        fail(`PUT ${itemUrl} — update did not persist: ${JSON.stringify(updated)}`);
        return;
      }
      pass(`PUT ${itemUrl} — update persisted`);

      const del = await fetch(itemUrl, { method: "DELETE", headers: CLIENT });
      if (!del.ok) {
        fail(`DELETE ${itemUrl} — ${del.status} ${del.statusText}`);
        return;
      }
      pass(`DELETE ${itemUrl} — ${del.status}`);
    } catch (err) {
      fail(`${base} — ${err.message}`);
    }

    // RequireClientId answers a request without the header with its own 401.
    // An association can take a while to reach the stage, so poll.
    let last;
    const blocked = await pollUntil(
      async () => {
        const res = await fetch(base);
        last = `${res.status} ${await res.text()}`;
        return res.status === 401 && last.includes(HEADER);
      },
      { timeoutMs: 120_000, intervalMs: 5_000 },
    );
    if (blocked) {
      pass(`GET ${base} without ${HEADER} — blocked by the web ACL with 401`);
    } else {
      fail(`GET ${base} without ${HEADER} — expected the web ACL's 401, last got ${last}`);
    }
  },
};
