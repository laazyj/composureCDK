import { type IHostedZone, RecordTarget } from "aws-cdk-lib/aws-route53";
import { Construct, type IConstruct } from "constructs";
import { constructId, type Lifecycle, resolve, type Resolvable } from "@composurecdk/core";
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
  type AliasRecordSpec,
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
 * keyed by the record's DNS name; the apex uses the {@link APEX} sentinel
 * (`"@"`) so it never collides with a user-supplied label.
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

/**
 * Structural bound shared by every per-type record builder: exposes the three
 * optional fields the DSL treats uniformly. Kept as an interface rather than
 * an inline generic bound so type errors point at a named contract.
 */
interface HasCommonRecordOptions<Self> {
  ttl(d: NonNullable<RecordOptions["ttl"]>): Self;
  comment(c: string): Self;
  recordName(n: string): Self;
}

type BucketName = keyof ZoneRecordsBuilderResult;

class ZoneRecordsBuilder implements IZoneRecordsBuilder {
  #zone?: Resolvable<IHostedZone>;
  readonly #specs: readonly RecordSpec[];

  constructor(specs: readonly RecordSpec[]) {
    this.#specs = specs;
  }

  zone(zone: Resolvable<IHostedZone>): this {
    this.#zone = zone;
    return this;
  }

  build(scope: IConstruct, id: string, context?: Record<string, object>): ZoneRecordsBuilderResult {
    if (!this.#zone) {
      throw new Error(`zoneRecords "${id}" requires a zone. Call .zone() with an IHostedZone.`);
    }
    validateSpecs(this.#specs);
    const zone = resolve(this.#zone, context ?? {});
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
    const root = new Construct(scope, id);
    const subScopes = new Map<BucketName, Construct>();
    const subScope = (bucket: BucketName): Construct => {
      let s = subScopes.get(bucket);
      if (!s) {
        s = new Construct(root, bucket);
        subScopes.set(bucket, s);
      }
      return s;
    };
    for (const group of groupRecords(this.#specs)) {
      const head = group[0];
      // Use the APEX sentinel ("@") as the result-map key, but a readable
      // "Apex" as the construct id so the synthesised logical ID keeps a
      // human-visible marker. ("@" sanitises to empty and produces opaque
      // logical IDs like `DNSrecordsa85669662`.) CDK's duplicate-id check
      // catches the rare case of a user-supplied label also spelled "Apex".
      const key = head.name;
      const childId = key === APEX ? "Apex" : constructId(key);
      switch (head.type) {
        case "A":
          result.a[key] = buildA(subScope("a"), childId, group as ARecordSpec[], zone, context);
          break;
        case "AAAA":
          result.aaaa[key] = buildAaaa(
            subScope("aaaa"),
            childId,
            group as AaaaRecordSpec[],
            zone,
            context,
          );
          break;
        case "CNAME":
          result.cname[key] = buildCname(
            subScope("cname"),
            childId,
            group as CnameRecordSpec[],
            zone,
            context,
          );
          break;
        case "TXT":
          result.txt[key] = buildTxt(
            subScope("txt"),
            childId,
            group as TxtRecordSpec[],
            zone,
            context,
          );
          break;
        case "MX":
          result.mx[key] = buildMx(subScope("mx"), childId, group as MxRecordSpec[], zone, context);
          break;
        case "SRV":
          result.srv[key] = buildSrv(
            subScope("srv"),
            childId,
            group as SrvRecordSpec[],
            zone,
            context,
          );
          break;
        case "CAA":
          result.caa[key] = buildCaa(
            subScope("caa"),
            childId,
            group as CaaRecordSpec[],
            zone,
            context,
          );
          break;
        case "NS":
          result.ns[key] = buildNs(subScope("ns"), childId, group as NsRecordSpec[], zone, context);
          break;
        case "DS":
          result.ds[key] = buildDs(subScope("ds"), childId, group as DsRecordSpec[], zone, context);
          break;
        case "HTTPS":
          result.https[key] = buildHttps(
            subScope("https"),
            childId,
            group as HttpsRecordSpec[],
            zone,
            context,
          );
          break;
        case "SVCB":
          result.svcb[key] = buildSvcb(
            subScope("svcb"),
            childId,
            group as SvcbRecordSpec[],
            zone,
            context,
          );
          break;
        case "ALIAS": {
          const aliasGroup = group as AliasRecordSpec[];
          if (aliasGroup.length > 1) {
            throw new Error(
              `ALIAS for "${head.name}" (${head.ipv6 ? "AAAA" : "A"}) declared ` +
                `${String(aliasGroup.length)} times. ` +
                `DNS allows only one alias record per (type, name).`,
            );
          }
          const spec = aliasGroup[0];
          if (spec.ipv6) {
            result.aaaa[key] = buildAliasAaaa(subScope("aaaa"), childId, spec, zone, context);
          } else {
            result.a[key] = buildAliasA(subScope("a"), childId, spec, zone, context);
          }
          break;
        }
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

/** Preserve insertion order while dropping duplicates. */
const dedupe = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

function validateSpecs(specs: readonly RecordSpec[]): void {
  const aliasNames = { a: new Set<string>(), aaaa: new Set<string>() };
  for (const spec of specs) {
    if (spec.type === "ALIAS") {
      const bucket = spec.ipv6 ? aliasNames.aaaa : aliasNames.a;
      bucket.add(spec.name);
    }
  }
  for (const spec of specs) {
    switch (spec.type) {
      case "A":
        if (spec.addresses.length === 0) {
          throw new Error(`${spec.type}("${spec.name}") must supply at least one address.`);
        }
        if (aliasNames.a.has(spec.name)) {
          throw new Error(
            `A("${spec.name}") cannot coexist with ALIAS("${spec.name}"). ` +
              `DNS allows only one record set per (type, name).`,
          );
        }
        break;
      case "AAAA":
        if (spec.addresses.length === 0) {
          throw new Error(`${spec.type}("${spec.name}") must supply at least one address.`);
        }
        if (aliasNames.aaaa.has(spec.name)) {
          throw new Error(
            `AAAA("${spec.name}") cannot coexist with ALIAS("${spec.name}", { ipv6: true }). ` +
              `DNS allows only one record set per (type, name).`,
          );
        }
        break;
      case "TXT":
      case "MX":
      case "SRV":
      case "CAA":
      case "NS":
      case "DS":
      case "HTTPS":
      case "SVCB":
        if (spec.values.length === 0) {
          throw new Error(`${spec.type}("${spec.name}") must supply at least one value.`);
        }
        break;
      case "CNAME":
      case "ALIAS":
        // CNAME carries a single `target` string; the DSL factory cannot
        // produce an empty one. ALIAS carries a single target value and is
        // checked for duplicates during grouping.
        break;
    }
  }
}

/**
 * Group records by `(type, name)`, preserving the insertion order of groups.
 * `ALIAS` specs are split further by `ipv6` so an A-alias and an AAAA-alias at
 * the same name land in separate groups (they emit distinct record types).
 */
function groupRecords(specs: readonly RecordSpec[]): RecordSpec[][] {
  const groups = new Map<string, RecordSpec[]>();
  for (const s of specs) {
    const k = s.type === "ALIAS" ? `ALIAS/${s.ipv6 ? "6" : "4"}/${s.name}` : `${s.type}/${s.name}`;
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

function applyCommon<B extends HasCommonRecordOptions<B>>(
  builder: B,
  specs: readonly RecordOptions[],
  name: string | undefined,
): B {
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
  context?: Record<string, object>,
): ARecordBuilderResult {
  const addresses = dedupe(specs.flatMap((s) => [...s.addresses]));
  const b = applyCommon(
    createARecordBuilder()
      .zone(zone)
      .target(RecordTarget.fromIpAddresses(...addresses)),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id, context);
}

function buildAaaa(
  scope: IConstruct,
  id: string,
  specs: AaaaRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
): AaaaRecordBuilderResult {
  const addresses = dedupe(specs.flatMap((s) => [...s.addresses]));
  const b = applyCommon(
    createAaaaRecordBuilder()
      .zone(zone)
      .target(RecordTarget.fromIpAddresses(...addresses)),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id, context);
}

function buildCname(
  scope: IConstruct,
  id: string,
  specs: CnameRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
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
  return b.build(scope, id, context);
}

function buildTxt(
  scope: IConstruct,
  id: string,
  specs: TxtRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
): TxtRecordBuilderResult {
  const values = dedupe(specs.flatMap((s) => [...s.values]));
  const b = applyCommon(
    createTxtRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id, context);
}

function buildMx(
  scope: IConstruct,
  id: string,
  specs: MxRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
): MxRecordBuilderResult {
  const values = specs.flatMap((s) =>
    s.values.map((v) => ({ priority: v.priority, hostName: v.hostName })),
  );
  const b = applyCommon(
    createMxRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id, context);
}

function buildSrv(
  scope: IConstruct,
  id: string,
  specs: SrvRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
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
  return b.build(scope, id, context);
}

function buildCaa(
  scope: IConstruct,
  id: string,
  specs: CaaRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
): CaaRecordBuilderResult {
  const values = specs.flatMap((s) =>
    s.values.map((v) => ({ flag: v.flag, tag: v.tag, value: v.value })),
  );
  const b = applyCommon(
    createCaaRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id, context);
}

function buildNs(
  scope: IConstruct,
  id: string,
  specs: NsRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
): NsRecordBuilderResult {
  const name = sub(specs[0].name);
  if (!name) {
    throw new Error(
      `NS records cannot live at the zone apex. The apex NS set is managed by Route 53.`,
    );
  }
  const values = dedupe(specs.flatMap((s) => [...s.values]));
  const b = applyCommon(createNsRecordBuilder().zone(zone).values(values), specs, name);
  return b.build(scope, id, context);
}

function buildDs(
  scope: IConstruct,
  id: string,
  specs: DsRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
): DsRecordBuilderResult {
  const values = dedupe(specs.flatMap((s) => [...s.values]));
  const b = applyCommon(
    createDsRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id, context);
}

function buildHttps(
  scope: IConstruct,
  id: string,
  specs: HttpsRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
): HttpsRecordBuilderResult {
  const values = specs.flatMap((s) => [...s.values]);
  const b = applyCommon(
    createHttpsRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id, context);
}

function buildSvcb(
  scope: IConstruct,
  id: string,
  specs: SvcbRecordSpec[],
  zone: IHostedZone,
  context?: Record<string, object>,
): SvcbRecordBuilderResult {
  const values = specs.flatMap((s) => [...s.values]);
  const b = applyCommon(
    createSvcbRecordBuilder().zone(zone).values(values),
    specs,
    sub(specs[0].name),
  );
  return b.build(scope, id, context);
}

function buildAliasA(
  scope: IConstruct,
  id: string,
  spec: AliasRecordSpec,
  zone: IHostedZone,
  context?: Record<string, object>,
): ARecordBuilderResult {
  const b = applyCommon(
    createARecordBuilder().zone(zone).target(spec.target),
    [spec],
    sub(spec.name),
  );
  return b.build(scope, id, context);
}

function buildAliasAaaa(
  scope: IConstruct,
  id: string,
  spec: AliasRecordSpec,
  zone: IHostedZone,
  context?: Record<string, object>,
): AaaaRecordBuilderResult {
  const b = applyCommon(
    createAaaaRecordBuilder().zone(zone).target(spec.target),
    [spec],
    sub(spec.name),
  );
  return b.build(scope, id, context);
}
