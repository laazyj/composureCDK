// Exercises the full gadget lifecycle end-to-end, proving the API Gateway ->
// DynamoDB `AwsIntegration` wiring (and the role's grantReadWriteData) work
// against live AWS, not just that the endpoint responds. api-endpoints.smoke.mjs
// only checks a single path per API — this stack's runtime surface is the
// CRUD flow itself, so it gets a dedicated smoke test.

export default {
  name: "CRUD API gadget lifecycle",
  run: async ({ aws, region, pass, fail }) => {
    const { items } = aws("apigateway", "get-rest-apis", "--output", "json");
    const api = (items ?? []).find((a) => a.name === "CrudApi");
    if (!api) {
      fail("CrudApi REST API not found");
      return;
    }

    const base = `https://${api.id}.execute-api.${region}.amazonaws.com/prod/gadgets`;
    const marker = `smoke-${process.pid}-${Date.now()}`;

    try {
      const created = await jsonRequest(base, "POST", {
        name: marker,
        description: "created by smoke test",
      });
      if (!created.id) {
        fail(`POST ${base} — no id in response: ${JSON.stringify(created)}`);
        return;
      }
      pass(`POST ${base} — created ${created.id}`);

      const itemUrl = `${base}/${created.id}`;

      const read = await jsonRequest(itemUrl, "GET");
      if (read.name !== marker) {
        fail(`GET ${itemUrl} — expected name "${marker}", got ${JSON.stringify(read)}`);
        return;
      }
      pass(`GET ${itemUrl} — read back the created gadget`);

      await jsonRequest(itemUrl, "PUT", { name: marker, description: "updated by smoke test" });
      const updated = await jsonRequest(itemUrl, "GET");
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

async function jsonRequest(url, method, body) {
  const res = await fetch(url, { method, body: body ? JSON.stringify(body) : undefined });
  return res.json();
}
