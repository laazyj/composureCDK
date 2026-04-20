import { type IHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { Construct, type IConstruct } from "constructs";
import { type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
import { type AaaaRecordBuilderResult, createAaaaRecordBuilder } from "../aaaa-record-builder.js";
import { type ARecordBuilderResult, createARecordBuilder } from "../a-record-builder.js";
import { type CaaRecordBuilderResult, createCaaRecordBuilder } from "../caa-record-builder.js";
import {
  type CnameRecordBuilderResult,
  createCnameRecordBuilder,
} from "../cname-record-builder.js";
import { type DsRecordBuilderResult, createDsRecordBuilder } from "../ds-record-builder.js";
import {
  type HttpsRecordBuilderResult,
  createHttpsRecordBuilder,
} from "../https-record-builder.js";
import { type MxRecordBuilderResult, createMxRecordBuilder } from "../mx-record-builder.js";
import { type NsRecordBuilderResult, createNsRecordBuilder } from "../ns-record-builder.js";
import { type SrvRecordBuilderResult, createSrvRecordBuilder } from "../srv-record-builder.js";
import { type SvcbRecordBuilderResult, createSvcbRecordBuilder } from "../svcb-record-builder.js";
import { type TxtRecordBuilderResult, createTxtRecordBuilder } from "../txt-record-builder.js";
import {
  APEX,
  type AaaaRecordSpec,
  type ARecordSpec,
  type CaaRecordSpec,
  type CnameRecordSpec,
  type DsRecordSpec,
  type HttpsRecordSpec,
  type MxRecordSpec,
  type NsRecordSpec,
  type RecordOptions,
  type RecordSpec,
  type SrvRecordSpec,
  type SvcbRecordSpec,
  type TxtRecordSpec,
} from "./zone-dsl.js";

/**
 * Build output of {@link zoneRecords}, split per record type. Each sub-map is
 * keyed by the record's DNS name (the apex uses `"apex"`, matching the
 * construct id).
 */
export interface ZoneRecordsBuilderResult {
  readonly a: Record<string, ARecordBuilderResult>;
  readonly aaaa: Record<string, AaaaRecordBuilderResult>;
  readonly cname: Record<string, CnameRecordBuilderResult>;
  readonly txt: Record<string, TxtRecordBuilderResult>;
  readonly mx: Record<string, MxRecordBuilderResult>;
  readonly srv: Record<string, SrvRecordBuilderResult>;
  readonly caa: Record<string, CaaRecordBuilderResult>;
  readonly ns: Record<string, NsRecordBuilderResult>;
  readonly ds: Record<string, DsRecordBuilderResult>;
  readonly https: Record<string, HttpsRecordBuilderResult>;
  readonly svcb: Record<string, SvcbRecordBuilderResult>;
}

/**
 * Fluent builder that emits every record for a hosted zone from a
 * {@link RecordSpec} list as a single composable {@link Lifecycle}.
 *
 * Records sharing `(type, name)` are merged into one CDK record set, matching
 * DNS RR-set semantics. Every type uses its matching `@composurecdk/route53`
 * builder, inheriting per-type TTL defaults.
 */
export interface IZoneRecordsBuilder extends Lifecycle<ZoneRecordsBuilderResult> {
  /**
   * The hosted zone to attach every record to. Accepts a {@link Resolvable},
   * so a zone produced by a sibling compose component can be wired in via
   * `ref("zone").get("hostedZone")`.
   */
  zone(zone: Resolvable<IHostedZone>): IZoneRecordsBuilder;
}

/**
 * Creates a single compose component that emits every record in `specs`.
 *
 * @example
 * ```ts
 * compose(
 *   {
 *     zone: createHostedZoneBuilder().zoneName("example.com"),
 *     records: zoneRecords([
 *       A("@",     "1.2.3.4"),
 *       MX("@", 10, "mail.example.com."),
 *     ]).zone(ref<HostedZoneBuilderResult>("zone").get("hostedZone")),
 *   },
 *   { zone: [], records: ["zone"] },
 * ).build(stack, "DNS");
 * ```
 */
export function zoneRecords(specs: readonly RecordSpec[]): IZoneRecordsBuilder {
  return new ZoneRecordsBuilder(specs);
}

class ZoneRecordsBuilder implements IZoneRecordsBuilder {
  private _zone?: Resolvable<IHostedZone>;

  constructor(private readonly specs: readonly RecordSpec[]) {}

  zone(zone: Resolvable<IHostedZone>): this {
    this._zone = zone;
    return this;
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): ZoneRecordsBuilderResult {
    if (!this._zone) {
      throw new Error(`zoneRecords "${id}" requires a zone. Call .zone() with an IHostedZone.`);
    }
    const zone = resolve(this._zone, context ?? {});
    const result: Mutable<ZoneRecordsBuilderResult> = {
      a: {},
      aaaa: {},
      cname: {},
      txt: {},
      mx: {},
      srv: {},
      caa: {},
      ns: {},
      ds: {},
      https: {},
      svcb: {},
    };
    const subScopes = new Map<keyof ZoneRecordsBuilderResult, Construct>();
    const subScope = (bucket: keyof ZoneRecordsBuilderResult): Construct => {
      let s = subScopes.get(bucket);
      if (!s) {
        s = new Construct(scope, `${id}/${bucket}`);
        subScopes.set(bucket, s);
      }
      return s;
    };
    for (const group of groupRecords(this.specs)) {
      const head = group[0];
      const name = head.name === APEX ? "apex" : head.name;
      switch (head.type) {
        case "A":
          result.a[name] = buildA(subScope("a"), name, group as ARecordSpec[], zone);
          break;
        case "AAAA":
          result.aaaa[name] = buildAaaa(subScope("aaaa"), name, group as AaaaRecordSpec[], zone);
          break;
        case "CNAME":
          result.cname[name] = buildCname(
            subScope("cname"),
            name,
            group as CnameRecordSpec[],
            zone,
          );
          break;
        case "TXT":
          result.txt[name] = buildTxt(subScope("txt"), name, group as TxtRecordSpec[], zone);
          break;
        case "MX":
          result.mx[name] = buildMx(subScope("mx"), name, group as MxRecordSpec[], zone);
          break;
        case "SRV":
          result.srv[name] = buildSrv(subScope("srv"), name, group as SrvRecordSpec[], zone);
          break;
        case "CAA":
          result.caa[name] = buildCaa(subScope("caa"), name, group as CaaRecordSpec[], zone);
          break;
        case "NS":
          result.ns[name] = buildNs(subScope("ns"), name, group as NsRecordSpec[], zone);
          break;
        case "DS":
          result.ds[name] = buildDs(subScope("ds"), name, group as DsRecordSpec[], zone);
          break;
        case "HTTPS":
          result.https[name] = buildHttps(
            subScope("https"),
            name,
            group as HttpsRecordSpec[],
            zone,
          );
          break;
        case "SVCB":
          result.svcb[name] = buildSvcb(subScope("svcb"), name, group as SvcbRecordSpec[], zone);
          break;
        default: {
          const _exhaustive: never = head;
          throw new Error(`Unhandled record type: ${(_exhaustive as RecordSpec).type}`);
        }
      }
    }
    return result;
  }
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/** CDK-style record-name convention: apex is `undefined`. */
const sub = (name: string) => (name === APEX ? undefined : name);

/** Group records by `(type, name)`, preserving the insertion order of groups. */
function groupRecords(specs: readonly RecordSpec[]): RecordSpec[][] {
  const groups = new Map<string, RecordSpec[]>();
  for (const s of specs) {
    const k = `${s.type}/${s.name}`;
    const existing = groups.get(k);
    if (existing) existing.push(s);
    else groups.set(k, [s]);
  }
  return [...groups.values()];
}

/** First non-undefined value of `field` across the group, or `undefined`. */
function pickOption<K extends keyof RecordOptions>(
  group: readonly RecordOptions[],
  field: K,
): RecordOptions[K] | undefined {
  for (const s of group) if (s[field] !== undefined) return s[field];
  return undefined;
}

function applyCommon<
  B extends {
    ttl(d: NonNullable<RecordOptions["ttl"]>): B;
    comment(c: string): B;
    recordName(n: string): B;
  },
>(builder: B, specs: readonly RecordOptions[], name: string | undefined): B {
  let b = builder;
  if (name) b = b.recordName(name);
  const ttl = pickOption(specs, "ttl");
  if (ttl) b = b.ttl(ttl);
  const comment = pickOption(specs, "comment");
  if (comment) b = b.comment(comment);
  return b;
}

function buildA(
  scope: IConstruct,
  id: string,
  specs: ARecordSpec[],
  zone: IHostedZone,
): ARecordBuilderResult {
  const addresses = specs.flatMap((s) => [...s.addresses]);
  const b = applyCommon(
    createARecordBuilder()
      .zone(zone)
      .target(RecordTarget.fromIpAddresses(...addresses)),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}

function buildAaaa(
  scope: IConstruct,
  id: string,
  specs: AaaaRecordSpec[],
  zone: IHostedZone,
): AaaaRecordBuilderResult {
  const addresses = specs.flatMap((s) => [...s.addresses]);
  const b = applyCommon(
    createAaaaRecordBuilder()
      .zone(zone)
      .target(RecordTarget.fromIpAddresses(...addresses)),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}

function buildCname(
  scope: IConstruct,
  id: string,
  specs: CnameRecordSpec[],
  zone: IHostedZone,
): CnameRecordBuilderResult {
  if (specs.length > 1) {
    throw new Error(
      `CNAME for "${specs[0].name}" declared ${String(specs.length)} times. ` +
        `DNS allows at most one CNAME per name.`,
    );
  }
  const [spec] = specs;
  const name = sub(spec.name);
  if (!name) throw new Error("CNAME records cannot live at the zone apex.");
  let b = createCnameRecordBuilder().zone(zone).recordName(name).domainName(spec.target);
  if (spec.ttl) b = b.ttl(spec.ttl);
  if (spec.comment) b = b.comment(spec.comment);
  return b.build(scope, id);
}

function buildTxt(
  scope: IConstruct,
  id: string,
  specs: TxtRecordSpec[],
  zone: IHostedZone,
): TxtRecordBuilderResult {
  const values = specs.flatMap((s) => [...s.values]);
  const b = applyCommon(
    createTxtRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}

function buildMx(
  scope: IConstruct,
  id: string,
  specs: MxRecordSpec[],
  zone: IHostedZone,
): MxRecordBuilderResult {
  const values = specs.flatMap((s) =>
    s.values.map((v) => ({ priority: v.priority, hostName: v.hostName })),
  );
  const b = applyCommon(
    createMxRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}

function buildSrv(
  scope: IConstruct,
  id: string,
  specs: SrvRecordSpec[],
  zone: IHostedZone,
): SrvRecordBuilderResult {
  const values = specs.flatMap((s) =>
    s.values.map((v) => ({
      priority: v.priority,
      weight: v.weight,
      port: v.port,
      hostName: v.hostName,
    })),
  );
  const b = applyCommon(
    createSrvRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}

function buildCaa(
  scope: IConstruct,
  id: string,
  specs: CaaRecordSpec[],
  zone: IHostedZone,
): CaaRecordBuilderResult {
  const values = specs.flatMap((s) =>
    s.values.map((v) => ({ flag: v.flag, tag: v.tag, value: v.value })),
  );
  const b = applyCommon(
    createCaaRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}

function buildNs(
  scope: IConstruct,
  id: string,
  specs: NsRecordSpec[],
  zone: IHostedZone,
): NsRecordBuilderResult {
  const name = sub(specs[0].name);
  if (!name) {
    throw new Error(
      `NS records cannot live at the zone apex. The apex NS set is managed by Route 53.`,
    );
  }
  const values = specs.flatMap((s) => [...s.values]);
  const b = applyCommon(createNsRecordBuilder().zone(zone).values(values), specs, name);
  return b.build(scope, id);
}

function buildDs(
  scope: IConstruct,
  id: string,
  specs: DsRecordSpec[],
  zone: IHostedZone,
): DsRecordBuilderResult {
  const values = specs.flatMap((s) => [...s.values]);
  const b = applyCommon(
    createDsRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}

function buildHttps(
  scope: IConstruct,
  id: string,
  specs: HttpsRecordSpec[],
  zone: IHostedZone,
): HttpsRecordBuilderResult {
  const values = specs.flatMap((s) => [...s.values]);
  const b = applyCommon(
    createHttpsRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}

function buildSvcb(
  scope: IConstruct,
  id: string,
  specs: SvcbRecordSpec[],
  zone: IHostedZone,
): SvcbRecordBuilderResult {
  const values = specs.flatMap((s) => [...s.values]);
  const b = applyCommon(
    createSvcbRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id);
}
