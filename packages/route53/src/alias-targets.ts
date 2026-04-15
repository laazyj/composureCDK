import { type IDistribution } from "aws-cdk-lib/aws-cloudfront";
import { type IDomainName, type RestApiBase } from "aws-cdk-lib/aws-apigateway";
import { RecordTarget } from "aws-cdk-lib/aws-route53";
import { ApiGateway, ApiGatewayDomain, CloudFrontTarget } from "aws-cdk-lib/aws-route53-targets";
import { isRef, type Resolvable } from "@composurecdk/core";

/**
 * Builds an alias {@link RecordTarget} for a CloudFront distribution, usable
 * as the `target` of an A or AAAA record. Accepts a {@link Resolvable} so a
 * distribution produced by a composed `@composurecdk/cloudfront` component
 * can be wired in via {@link ref}.
 *
 * @example
 * ```ts
 * createARecordBuilder()
 *   .zone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone))
 *   .target(cloudfrontAliasTarget(
 *     ref("cdn", (r: DistributionBuilderResult) => r.distribution),
 *   ));
 * ```
 */
export function cloudfrontAliasTarget(
  distribution: Resolvable<IDistribution>,
): Resolvable<RecordTarget> {
  return isRef(distribution)
    ? distribution.map((d) => RecordTarget.fromAlias(new CloudFrontTarget(d)))
    : RecordTarget.fromAlias(new CloudFrontTarget(distribution));
}

/**
 * Builds an alias {@link RecordTarget} for an API Gateway REST API that has a
 * custom domain name configured via {@link RestApiBase}. Accepts a
 * {@link Resolvable}.
 */
export function apiGatewayAliasTarget(api: Resolvable<RestApiBase>): Resolvable<RecordTarget> {
  return isRef(api)
    ? api.map((a) => RecordTarget.fromAlias(new ApiGateway(a)))
    : RecordTarget.fromAlias(new ApiGateway(api));
}

/**
 * Builds an alias {@link RecordTarget} for an API Gateway custom domain name
 * (`apigateway.DomainName`). Use this when you manage the domain name resource
 * separately from the REST API (e.g. to share a custom domain across multiple
 * APIs). Accepts a {@link Resolvable}.
 */
export function apiGatewayDomainAliasTarget(
  domain: Resolvable<IDomainName>,
): Resolvable<RecordTarget> {
  return isRef(domain)
    ? domain.map((d) => RecordTarget.fromAlias(new ApiGatewayDomain(d)))
    : RecordTarget.fromAlias(new ApiGatewayDomain(domain));
}
