import {
  HttpVersion,
  PriceClass,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import type { DistributionBuilderProps } from "./distribution-builder.js";

/**
 * Secure, AWS-recommended defaults applied to every CloudFront distribution
 * built with {@link createDistributionBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 *
 * The `defaultBehavior` defaults (viewer protocol policy, response headers
 * policy) are deep-merged with user-provided behavior options in `build()`,
 * then the resolved origin is injected.
 */
export const DISTRIBUTION_DEFAULTS: Partial<DistributionBuilderProps> = {
  /**
   * Automatically create an S3 logging bucket for CloudFront standard access logs.
   * Access logging provides an audit trail of all viewer requests for security
   * monitoring and troubleshooting.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/sec_detect_investigate_events_app_service_logging.html
   */
  accessLogging: true,

  /**
   * Use the cheapest price class — edge locations in North America and Europe.
   * Sufficient for most small websites and avoids costs from global edge locations.
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/PriceClass.html
   */
  priceClass: PriceClass.PRICE_CLASS_100,

  /**
   * Enable HTTP/2 and HTTP/3 (QUIC) for improved performance. HTTP/3 is
   * backwards-compatible — viewers that don't support it fall back to HTTP/2.
   * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/distribution-web-values-specify.html#DownloadDistValuesSupportedHTTPVersions
   */
  httpVersion: HttpVersion.HTTP2_AND_3,

  /**
   * Serve index.html for the root path.
   * Standard for static website hosting.
   */
  defaultRootObject: "index.html",

  /**
   * Require TLS 1.2 (2021 policy) as the minimum protocol version.
   * Prevents negotiation of older, less secure TLS versions.
   * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-in-transit.html
   */
  minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2021,

  defaultBehavior: {
    /**
     * Redirect HTTP to HTTPS — ensures all viewer traffic is encrypted in transit.
     * @see https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-data-in-transit.html
     */
    viewerProtocolPolicy: ViewerProtocolPolicy.REDIRECT_TO_HTTPS,

    /**
     * Apply the managed security headers policy (HSTS, X-Content-Type-Options,
     * X-Frame-Options, etc.).
     * @see https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/using-managed-response-headers-policies.html
     */
    responseHeadersPolicy: ResponseHeadersPolicy.SECURITY_HEADERS,
  },
};
