import { getStackOutput } from "./_helpers.mjs";

const STACK = "ComposureCDK-StaticWebsiteStack";

export default {
  name: "Static website checks",
  run: async ({ aws, pass, fail }) => {
    const siteUrl = getStackOutput(aws, STACK, "DistributionUrl");
    const errorUrl = `${siteUrl}/does-not-exist`;

    const [indexRes, errorRes] = await Promise.all([fetch(siteUrl), fetch(errorUrl)]);
    const [indexBody, errorBody] = await Promise.all([indexRes.text(), errorRes.text()]);

    if (indexRes.ok && indexBody.includes("</html>")) {
      pass(`${siteUrl} — ${indexRes.status} (index page)`);
    } else {
      fail(`${siteUrl} — ${indexRes.status} (expected HTML index page)`);
    }

    if (errorRes.status === 404 && errorBody.includes("</html>")) {
      pass(`${errorUrl} — ${errorRes.status} (custom error page)`);
    } else {
      fail(`${errorUrl} — ${errorRes.status} (expected 404 with custom error page)`);
    }
  },
};
