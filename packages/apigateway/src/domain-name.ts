import type { DomainNameOptions } from "aws-cdk-lib/aws-apigateway";
import { resolve } from "@composurecdk/core";
import type { RestApiBuilderPropsBase } from "./builder-common.js";
import { DOMAIN_NAME_DEFAULTS } from "./defaults.js";

/**
 * Resolves a builder's `domainName` for CDK: the certificate against the
 * build context, with {@link DOMAIN_NAME_DEFAULTS} under the user's options.
 * The defaults are the same for both builders, so they are not a parameter.
 */
export function resolveDomainName(
  domainName: RestApiBuilderPropsBase["domainName"],
  context: Record<string, object> | undefined,
): DomainNameOptions | undefined {
  if (domainName === undefined) return undefined;
  return {
    ...DOMAIN_NAME_DEFAULTS,
    ...domainName,
    certificate: resolve(domainName.certificate, context),
  };
}
