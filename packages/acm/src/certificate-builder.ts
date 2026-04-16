import {
  Certificate,
  CertificateValidation,
  type CertificateProps,
} from "aws-cdk-lib/aws-certificatemanager";
import type { IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import {
  Builder,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { CERTIFICATE_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the ACM certificate builder.
 *
 * Extends the CDK {@link CertificateProps} with additional builder-specific
 * options. The `validation` field is augmented by {@link validationZone} /
 * {@link validationZones}, which accept {@link Resolvable} hosted zones for
 * cross-component wiring (e.g. from `@composurecdk/route53`).
 *
 * If neither `validation`, `validationZone`, nor `validationZones` is set,
 * the builder fails fast — falling back to ACM's email-based validation would
 * stall stack creation waiting on a human to click a link.
 */
export interface CertificateBuilderProps extends CertificateProps {
  /**
   * The hosted zone used to automatically create DNS validation records
   * for every domain on the certificate. Accepts a {@link Resolvable} so a
   * zone from a {@link Lifecycle | composed} route53 component can be
   * wired in via {@link ref}.
   *
   * Mutually exclusive with {@link validationZones} and {@link CertificateProps.validation}.
   * When set, the builder configures
   * {@link CertificateValidation.fromDns | CertificateValidation.fromDns(zone)}.
   */
  validationZone?: Resolvable<IHostedZone>;

  /**
   * A map of domain name to hosted zone, used when the apex and subject
   * alternative names live in different zones. Each value accepts a
   * {@link Resolvable}. When set, the builder configures
   * {@link CertificateValidation.fromDnsMultiZone}.
   *
   * Mutually exclusive with {@link validationZone} and {@link CertificateProps.validation}.
   */
  validationZones?: Record<string, Resolvable<IHostedZone>>;
}

/**
 * The build output of an {@link ICertificateBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface CertificateBuilderResult {
  /** The ACM certificate construct created by the builder. */
  certificate: Certificate;
}

/**
 * A fluent builder for configuring and creating an AWS Certificate Manager
 * certificate.
 *
 * Each configuration property from the CDK {@link CertificateProps} is
 * exposed as an overloaded method: call with a value to set it (returns the
 * builder for chaining), or call with no arguments to read the current value.
 *
 * Validation is DNS-based by default — set
 * {@link CertificateBuilderProps.validationZone | validationZone} (or
 * {@link CertificateBuilderProps.validationZones | validationZones}) with the
 * hosted zone(s) that own the certificate's domains. Accepts a
 * {@link Resolvable} so zones produced by a composed route53 component can
 * be wired in via {@link ref}.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * an ACM certificate with the configured properties and returns a
 * {@link CertificateBuilderResult}.
 *
 * ## CloudFront caveat
 *
 * CloudFront viewer certificates must live in `us-east-1`. Place the ACM
 * component in a stack that targets `us-east-1` (the cheapest way is to
 * compose a dedicated stack via `@composurecdk/cloudformation`).
 *
 * @example
 * ```ts
 * const cert = createCertificateBuilder()
 *   .domainName("example.com")
 *   .subjectAlternativeNames(["www.example.com"])
 *   .validationZone(ref("zone", (r: HostedZoneBuilderResult) => r.hostedZone));
 * ```
 */
export type ICertificateBuilder = IBuilder<CertificateBuilderProps, CertificateBuilder>;

class CertificateBuilder implements Lifecycle<CertificateBuilderResult> {
  props: Partial<CertificateBuilderProps> = {};

  build(scope: IConstruct, id: string, context?: Record<string, object>): CertificateBuilderResult {
    const {
      validationZone,
      validationZones,
      validation: userValidation,
      ...certProps
    } = this.props;

    if (!certProps.domainName) {
      throw new Error(
        `CertificateBuilder "${id}" requires a domainName. ` +
          `Call .domainName() with the fully-qualified domain.`,
      );
    }

    if ([userValidation, validationZone, validationZones].filter(Boolean).length > 1) {
      throw new Error(
        `CertificateBuilder "${id}": 'validation', 'validationZone', and 'validationZones' ` +
          `are mutually exclusive. Set exactly one.`,
      );
    }

    const resolvedContext = context ?? {};
    let validation: CertificateValidation;

    if (userValidation) {
      validation = userValidation;
    } else if (validationZones) {
      const resolvedZones = Object.fromEntries(
        Object.entries(validationZones).map(([domain, zone]) => [
          domain,
          resolve(zone, resolvedContext),
        ]),
      );
      validation = CertificateValidation.fromDnsMultiZone(resolvedZones);
    } else if (validationZone) {
      validation = CertificateValidation.fromDns(resolve(validationZone, resolvedContext));
    } else {
      throw new Error(
        `CertificateBuilder "${id}" requires DNS validation to be configured. ` +
          `Call .validationZone() with the hosted zone for the certificate's domain, ` +
          `or .validationZones() when domains span multiple zones, ` +
          `or .validation() to configure an explicit CertificateValidation. ` +
          `Email validation is not enabled by default because it blocks stack creation.`,
      );
    }

    const mergedProps = {
      ...CERTIFICATE_DEFAULTS,
      ...certProps,
      validation,
    } as CertificateProps;

    const certificate = new Certificate(scope, id, mergedProps);

    return { certificate };
  }
}

/**
 * Creates a new {@link ICertificateBuilder} for configuring an ACM certificate.
 *
 * This is the entry point for defining an ACM certificate component. The
 * returned builder exposes every {@link CertificateBuilderProps} property as
 * a fluent setter/getter and implements {@link Lifecycle} for use with
 * {@link compose}.
 *
 * @returns A fluent builder for an ACM certificate.
 *
 * @example
 * ```ts
 * const cert = createCertificateBuilder()
 *   .domainName("example.com")
 *   .validationZone(zone);
 *
 * // Use standalone:
 * const result = cert.build(stack, "SiteCert");
 *
 * // Or compose into a system:
 * const system = compose(
 *   { zone: createHostedZoneBuilder().zoneName("example.com"), cert },
 *   { zone: [], cert: ["zone"] },
 * );
 * ```
 */
export function createCertificateBuilder(): ICertificateBuilder {
  return Builder<CertificateBuilderProps, CertificateBuilder>(CertificateBuilder);
}
