import {
  Certificate,
  CertificateValidation,
  type CertificateProps,
  type ICertificate,
} from "aws-cdk-lib/aws-certificatemanager";
import { type Alarm } from "aws-cdk-lib/aws-cloudwatch";
import type { IHostedZone } from "aws-cdk-lib/aws-route53";
import { type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type ITaggedBuilder, taggedBuilder } from "@composurecdk/cloudformation";
import { AlarmDefinitionBuilder } from "@composurecdk/cloudwatch";
import type { CertificateAlarmConfig } from "./alarm-config.js";
import { createCertificateAlarms } from "./certificate-alarms.js";
import { CERTIFICATE_DEFAULTS } from "./defaults.js";

/**
 * Configuration properties for the ACM certificate builder.
 *
 * Extends the CDK {@link CertificateProps} with additional builder-specific
 * options. The `validation` field is augmented by {@link validationZone} /
 * {@link validationZones}, which accept {@link Resolvable} hosted zones so
 * the validation zone can come from a composed component.
 *
 * If neither `validation`, `validationZone`, nor `validationZones` is set,
 * the builder fails fast — falling back to ACM's email-based validation would
 * stall stack creation waiting on a human to click a link.
 */
export interface CertificateBuilderProps extends CertificateProps {
  /**
   * The hosted zone used to automatically create DNS validation records
   * for every domain on the certificate. Accepts a {@link Resolvable} so
   * a zone produced by a sibling component can be wired in via `ref`.
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

  /**
   * Configuration for AWS-recommended CloudWatch alarms.
   *
   * By default, the builder creates a recommended `daysToExpiry` alarm
   * at 45 days. The alarm can be customized or disabled. Set to `false`
   * to disable all alarms.
   *
   * No alarm actions are configured by default since notification
   * methods are user-specific. Access alarms from the build result
   * or use an `afterBuild` hook to apply actions.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CertificateManager
   */
  recommendedAlarms?: CertificateAlarmConfig | false;
}

/**
 * The build output of an {@link ICertificateBuilder}. Contains the CDK
 * constructs created during {@link Lifecycle.build}, keyed by role.
 */
export interface CertificateBuilderResult {
  /** The ACM certificate construct created by the builder. */
  certificate: Certificate;

  /**
   * CloudWatch alarms created for the certificate, keyed by alarm name.
   *
   * Includes both AWS-recommended alarms and any custom alarms added
   * via {@link ICertificateBuilder.addAlarm}. Access individual alarms
   * by key (e.g., `result.alarms.daysToExpiry`).
   *
   * No alarm actions are configured — apply them via the result or an
   * `afterBuild` hook.
   *
   * @see https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Best_Practice_Recommended_Alarms_AWS_Services.html#CertificateManager
   */
  alarms: Record<string, Alarm>;
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
 * {@link Resolvable} so zones produced by a composed component can be
 * wired in via `ref`.
 *
 * The builder implements {@link Lifecycle}, so it can be used directly as a
 * component in a {@link compose | composed system}. When built, it creates
 * an ACM certificate with the configured properties and returns a
 * {@link CertificateBuilderResult}.
 *
 * The builder also creates AWS-recommended CloudWatch alarms by default
 * (`daysToExpiry` at 45 days). Alarms can be customized or disabled via the
 * `recommendedAlarms` property.
 *
 * @example
 * ```ts
 * const cert = createCertificateBuilder()
 *   .domainName("example.com")
 *   .subjectAlternativeNames(["www.example.com"])
 *   .validationZone(zone);
 * ```
 */
export type ICertificateBuilder = ITaggedBuilder<CertificateBuilderProps, CertificateBuilder>;

class CertificateBuilder implements Lifecycle<CertificateBuilderResult> {
  props: Partial<CertificateBuilderProps> = {};
  readonly #customAlarms: AlarmDefinitionBuilder<ICertificate>[] = [];

  addAlarm(
    key: string,
    configure: (
      alarm: AlarmDefinitionBuilder<ICertificate>,
    ) => AlarmDefinitionBuilder<ICertificate>,
  ): this {
    this.#customAlarms.push(configure(new AlarmDefinitionBuilder<ICertificate>(key)));
    return this;
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): CertificateBuilderResult {
    const {
      validationZone,
      validationZones,
      validation: userValidation,
      recommendedAlarms: alarmConfig,
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

    let validation: CertificateValidation;

    if (userValidation) {
      validation = userValidation;
    } else if (validationZones) {
      const resolvedZones = Object.fromEntries(
        Object.entries(validationZones).map(([domain, zone]) => [domain, resolve(zone, context)]),
      );
      validation = CertificateValidation.fromDnsMultiZone(resolvedZones);
    } else if (validationZone) {
      validation = CertificateValidation.fromDns(resolve(validationZone, context));
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

    const alarms = createCertificateAlarms(scope, id, certificate, alarmConfig, this.#customAlarms);

    return { certificate, alarms };
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
 * const result = cert.build(stack, "SiteCert");
 * ```
 */
export function createCertificateBuilder(): ICertificateBuilder {
  return taggedBuilder<CertificateBuilderProps, CertificateBuilder>(CertificateBuilder);
}
