import { type IHostedZone, type IPublicHostedZone } from "aws-cdk-lib/aws-route53";
import {
  type ByoDkimOptions,
  type DkimRecord,
  DkimIdentity,
  type EasyDkimSigningKeyLength,
  EmailIdentity,
  type EmailIdentityProps,
  Identity,
} from "aws-cdk-lib/aws-ses";
import { type IConstruct } from "constructs";
import {
  Builder,
  COPY_STATE,
  type IBuilder,
  type Lifecycle,
  resolve,
  type Resolvable,
} from "@composurecdk/core";
import { type ZoneRecordsBuilderResult } from "@composurecdk/route53/zone";
import { DEFAULT_MAIL_FROM_BEHAVIOR_ON_MX_FAILURE } from "./defaults.js";
import { type PublishDkimSpec, publishDkimRecords } from "./publish-dkim.js";

/**
 * Configuration for the SES email-identity builder. The `identity` and
 * `dkimIdentity` props are owned by the builder's fluent methods
 * ({@link IEmailIdentityBuilder.domain | `.domain()`} etc.); every other
 * {@link EmailIdentityProps} field passes through unchanged.
 */
export type EmailIdentityBuilderProps = Omit<EmailIdentityProps, "identity" | "dkimIdentity">;

/** The build output of an {@link IEmailIdentityBuilder}. */
export interface EmailIdentityBuilderResult {
  /** The SES email identity construct. */
  emailIdentity: EmailIdentity;
  /**
   * The identity's DKIM DNS records ({@link DkimRecord | `{ name, value }`}), as
   * exposed by CDK. For manual publication when a Route 53 zone is not available
   * to {@link IEmailIdentityBuilder.publishDkim | `.publishDkim()`}.
   */
  dkim: readonly DkimRecord[];
  /**
   * DNS records emitted by {@link IEmailIdentityBuilder.publishDkim}. Present
   * only when `.publishDkim(zone)` was called.
   */
  dkimRecords?: ZoneRecordsBuilderResult;
}

/**
 * A fluent builder for an SES email identity (domain or email address) with
 * Easy DKIM by default.
 *
 * @example
 * ```ts
 * const { emailIdentity } = createEmailIdentityBuilder()
 *   .domain("ask.example.com")
 *   .publishDkim(ref<HostedZoneBuilderResult>("zone").get("hostedZone"))
 *   .build(stack, "MailIdentity");
 * ```
 */
// eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::EmailIdentity has no Tags property
export type IEmailIdentityBuilder = IBuilder<EmailIdentityBuilderProps, EmailIdentityBuilder>;

/**
 * The mutually-exclusive identity source, set wholesale by exactly one of the
 * three variant methods — so exactly-one-source is a structural invariant rather
 * than something the setters must hand-maintain.
 */
type IdentitySource =
  | { readonly kind: "domain" | "email"; readonly identity: Identity }
  | { readonly kind: "zone"; readonly zone: Resolvable<IPublicHostedZone> };

class EmailIdentityBuilder implements Lifecycle<EmailIdentityBuilderResult> {
  props: Partial<EmailIdentityBuilderProps> = {};
  #source?: IdentitySource;
  #dkim: DkimIdentity = DkimIdentity.easyDkim();
  /** Set when BYODKIM is selected; `undefined` means Easy DKIM. */
  #byoDkim?: { readonly selector: string; readonly publicKey?: string };
  #publishZone?: Resolvable<IHostedZone>;

  /** Verify a whole domain (or subdomain). Publish DKIM with `.publishDkim()`. */
  domain(domain: string): this {
    this.#source = { kind: "domain", identity: Identity.domain(domain) };
    return this;
  }

  /** Verify a single email address. DKIM publication does not apply. */
  email(email: string): this {
    this.#source = { kind: "email", identity: Identity.email(email) };
    return this;
  }

  /**
   * Verify the apex of a public hosted zone. CDK auto-publishes DKIM (and any
   * MAIL FROM records) into the zone — use this for the "I own the whole zone"
   * case. For a subdomain whose apex lives elsewhere, use `.domain()` +
   * `.publishDkim()`.
   */
  publicHostedZone(zone: Resolvable<IPublicHostedZone>): this {
    this.#source = { kind: "zone", zone };
    return this;
  }

  /** Easy DKIM (the default), optionally at a non-default signing key length. */
  easyDkim(signingKeyLength?: EasyDkimSigningKeyLength): this {
    this.#dkim = DkimIdentity.easyDkim(signingKeyLength);
    this.#byoDkim = undefined;
    return this;
  }

  /** Bring-your-own DKIM. `.publishDkim()` emits a TXT record for the public key. */
  byoDkim(options: ByoDkimOptions): this {
    this.#dkim = DkimIdentity.byoDkim(options);
    this.#byoDkim = { selector: options.selector, publicKey: options.publicKey };
    return this;
  }

  /**
   * Publish the identity's DKIM DNS records into `zone` — three CNAMEs for Easy
   * DKIM, one TXT for BYODKIM. Requires a `.domain()` identity; throws for an
   * email identity or a `.publicHostedZone()` (which already auto-publishes).
   */
  publishDkim(zone: Resolvable<IHostedZone>): this {
    this.#publishZone = zone;
    return this;
  }

  /** @internal — see ADR-0005. */
  [COPY_STATE](target: EmailIdentityBuilder): void {
    target.#source = this.#source;
    target.#dkim = this.#dkim;
    target.#byoDkim = this.#byoDkim;
    target.#publishZone = this.#publishZone;
  }

  build(
    scope: IConstruct,
    id: string,
    context: Record<string, object> = {},
  ): EmailIdentityBuilderResult {
    const source = this.#source;
    if (!source) {
      throw new Error(
        `EmailIdentityBuilder "${id}": set an identity with .domain(), .email(), or .publicHostedZone().`,
      );
    }
    const identity =
      source.kind === "zone"
        ? Identity.publicHostedZone(resolve(source.zone, context))
        : source.identity;

    // Validate publication before creating any construct, so a misconfigured
    // `.publishDkim()` fails cleanly rather than after the identity is built.
    const publish = this.#publishZone
      ? { zone: this.#publishZone, spec: this.#dkimSpec(id, source) }
      : undefined;

    // A custom MAIL FROM defaults to rejecting on MX failure (no insecure
    // fallback to amazonses.com); an explicitly-set behaviour wins.
    const mailFromDefault =
      this.props.mailFromDomain !== undefined &&
      this.props.mailFromBehaviorOnMxFailure === undefined
        ? { mailFromBehaviorOnMxFailure: DEFAULT_MAIL_FROM_BEHAVIOR_ON_MX_FAILURE }
        : {};
    const props: EmailIdentityProps = {
      ...mailFromDefault,
      ...this.props,
      identity,
      dkimIdentity: this.#dkim,
    };
    const emailIdentity = new EmailIdentity(scope, id, props);

    const dkimRecords = publish
      ? publishDkimRecords(
          scope,
          `${id}DkimRecords`,
          emailIdentity,
          publish.spec,
          publish.zone,
          context,
        )
      : undefined;

    return {
      emailIdentity,
      dkim: emailIdentity.dkimRecords,
      ...(dkimRecords && { dkimRecords }),
    };
  }

  #dkimSpec(id: string, source: IdentitySource): PublishDkimSpec {
    if (source.kind === "zone") {
      throw new Error(
        `EmailIdentityBuilder "${id}": .publishDkim() is redundant with .publicHostedZone(), ` +
          `which already publishes DKIM into the zone. Use .domain() to publish DKIM for a subdomain.`,
      );
    }
    if (source.kind === "email") {
      throw new Error(
        `EmailIdentityBuilder "${id}": .publishDkim() needs a domain identity; ` +
          `email-address identities have no domain DKIM.`,
      );
    }
    if (this.#byoDkim) {
      if (this.#byoDkim.publicKey === undefined) {
        throw new Error(
          `EmailIdentityBuilder "${id}": .publishDkim() with BYODKIM needs a publicKey — ` +
            `pass it to .byoDkim({ publicKey }).`,
        );
      }
      return {
        mode: "byo",
        domain: source.identity.value,
        selector: this.#byoDkim.selector,
        publicKey: this.#byoDkim.publicKey,
      };
    }
    return { mode: "easy" };
  }
}

/**
 * Creates a fluent builder for an SES email identity.
 */
export function createEmailIdentityBuilder(): IEmailIdentityBuilder {
  // eslint-disable-next-line composurecdk/builder-must-be-tagged -- AWS::SES::EmailIdentity has no Tags property
  return Builder<EmailIdentityBuilderProps, EmailIdentityBuilder>(EmailIdentityBuilder);
}
