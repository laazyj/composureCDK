import { KeyAlgorithm } from "aws-cdk-lib/aws-certificatemanager";
import type { CertificateBuilderProps } from "./certificate-builder.js";

/**
 * Secure, AWS-recommended defaults applied to every ACM certificate built
 * with {@link createCertificateBuilder}. Each property can be individually
 * overridden via the builder's fluent API.
 */
export const CERTIFICATE_DEFAULTS: Partial<CertificateBuilderProps> = {
  /**
   * Use RSA-2048 as the key algorithm. Widest client/CDN compatibility
   * (CloudFront, API Gateway, ALB) and sufficient for TLS 1.2 and 1.3.
   * For newer workloads, `KeyAlgorithm.EC_PRIME256V1` offers smaller
   * signatures at comparable security — override via `.keyAlgorithm()`.
   * @see https://docs.aws.amazon.com/acm/latest/userguide/acm-certificate.html#algorithms.title
   */
  keyAlgorithm: KeyAlgorithm.RSA_2048,

  /**
   * Publish certificates to the public Certificate Transparency (CT) logs.
   * CT logging is required by modern browsers to trust a certificate and
   * enables detection of mis-issuance.
   * @see https://docs.aws.amazon.com/acm/latest/userguide/acm-bestpractices.html#best-practices-transparency
   */
  transparencyLoggingEnabled: true,
};
