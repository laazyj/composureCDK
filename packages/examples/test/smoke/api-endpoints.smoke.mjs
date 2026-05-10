// REST API name → root path to GET. New example REST APIs add an entry here;
// switch to a sibling *.smoke.mjs file once this exceeds ~6 entries.
const EXAMPLE_API_PATHS = {
  MockApi: "/",
  MultiStackApi: "/",
  PetStore: "/pets",
};

export default {
  name: "API endpoint checks",
  run: async ({ aws, region, pass, fail }) => {
    const { items } = aws("apigateway", "get-rest-apis", "--output", "json");
    const apis = (items ?? []).filter((api) => api.name in EXAMPLE_API_PATHS);

    if (apis.length === 0) {
      fail("No example REST APIs found");
      return;
    }

    await Promise.all(
      apis.map(async (api) => {
        const url = `https://${api.id}.execute-api.${region}.amazonaws.com/prod${EXAMPLE_API_PATHS[api.name]}`;
        try {
          const res = await fetch(url);
          if (res.ok) {
            pass(`${api.name} (${url}) — ${res.status}`);
          } else {
            fail(`${api.name} (${url}) — ${res.status} ${res.statusText}`);
          }
        } catch (err) {
          fail(`${api.name} (${url}) — ${err.message}`);
        }
      }),
    );
  },
};
