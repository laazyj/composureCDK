import { Token } from "aws-cdk-lib";
import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";
import { combine, isRef, type Resolvable } from "@composurecdk/core";
import { validateQueryArgumentName, validateReferenceArn } from "./names.js";
import { type ForwardedIpFallback, NO_TRANSFORMATION } from "./rate-limit.js";

/**
 * A text transformation WAF applies to a request component before it inspects
 * it, such as `LOWERCASE` or `URL_DECODE`.
 *
 * @see https://docs.aws.amazon.com/waf/latest/APIReference/API_TextTransformation.html
 */
export type TextTransformationType =
  | "NONE"
  | "COMPRESS_WHITE_SPACE"
  | "HTML_ENTITY_DECODE"
  | "LOWERCASE"
  | "CMD_LINE"
  | "URL_DECODE"
  | "BASE64_DECODE"
  | "HEX_DECODE"
  | "MD5"
  | "REPLACE_COMMENTS"
  | "ESCAPE_SEQ_DECODE"
  | "SQL_HEX_DECODE"
  | "CSS_DECODE"
  | "JS_DECODE"
  | "NORMALIZE_PATH"
  | "NORMALIZE_PATH_WIN"
  | "REMOVE_NULLS"
  | "REPLACE_NULLS"
  | "BASE64_DECODE_EXT"
  | "URL_DECODE_UNI"
  | "UTF8_TO_UNICODE"
  | "REMOVE_WHITESPACE"
  | "TRIM"
  | "TRIM_LEFT"
  | "TRIM_RIGHT"
  | "REMOVE_COMMENTS_CHAR"
  | "UPPERCASE"
  | "CMD_LINE_WIN"
  | "CMD_LINE_UNIX"
  | "JS_DECODE_EXT"
  | "SHA256";

/** Where a byte match's search string must appear in the request component. */
export type ByteMatchPosition =
  "EXACTLY" | "STARTS_WITH" | "ENDS_WITH" | "CONTAINS" | "CONTAINS_WORD";

/** How a size constraint compares the component's size with its `size`. */
export type SizeComparison = "EQ" | "NE" | "LE" | "LT" | "GE" | "GT";

/**
 * What WAF does with a body larger than it inspects: `CONTINUE` inspects what
 * it has, `MATCH` treats the request as matching, `NO_MATCH` as not.
 */
export type OversizeHandling = "CONTINUE" | "MATCH" | "NO_MATCH";

/** Match the client IP in a header, such as `X-Forwarded-For`, instead of the one the request came from. */
export interface ForwardedIpOptions {
  /** The header that carries the client IP. */
  readonly headerName: string;
  /** What to do with a request whose header holds no valid IP address. */
  readonly fallbackBehavior: ForwardedIpFallback;
}

/** Options for {@link ruleStatements.ipSet} when the client IP is in a header. */
export interface IpSetForwardedIpOptions extends ForwardedIpOptions {
  /**
   * Which address in a comma-separated list to match: `FIRST`, `LAST`, or
   * `ANY` of up to ten.
   */
  readonly position: "FIRST" | "LAST" | "ANY";
}

const API = "https://docs.aws.amazon.com/waf/latest/APIReference";
const LIMITS = "https://docs.aws.amazon.com/waf/latest/developerguide/limits.html";

/** The country codes WAF's `GeoMatchStatement` accepts: ISO 3166-1 alpha-2, plus `XK` for Kosovo. */
const COUNTRY_CODES: ReadonlySet<string> = new Set(
  (
    "AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW " +
    "BV BR IO BN BG BF BI KH CM CA CV KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ " +
    "DK DJ DM DO EC EG SV GQ ER EE ET FK FO FJ FI FR GF PF TF GA GM GE DE GH GI GR GL GD GP GU " +
    "GT GG GN GW GY HT HM VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW " +
    "KG LA LV LB LS LR LY LI LT LU MO MK MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS " +
    "MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA " +
    "RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK " +
    "SD SR SJ SZ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU " +
    "VE VN VG VI WF EH YE ZM ZW XK"
  ).split(" "),
);
const MAX_COUNTRY_CODES = 50;
const MAX_SEARCH_STRING_BYTES = 200;
const MAX_TRANSFORMATIONS = 10;
const MAX_SIZE = 21_474_836_480;

function fail(method: string, message: string, source: string): never {
  throw new Error(`ruleStatements.${method}(): ${message} See ${source}.`);
}

/** The statement's text transformations, in order; none when `types` is omitted. */
function textTransformations(
  method: string,
  types: readonly TextTransformationType[] | undefined,
): CfnWebACL.TextTransformationProperty[] {
  if (types === undefined) return [...NO_TRANSFORMATION];
  if (types.length < 1 || types.length > MAX_TRANSFORMATIONS) {
    fail(
      method,
      `a statement takes 1 to ${String(MAX_TRANSFORMATIONS)} text transformations, but ${String(types.length)} were given.`,
      LIMITS,
    );
  }
  return types.map((type, priority) => ({ priority, type }));
}

/**
 * The parts of a request a match statement can inspect, in the casing
 * CloudFormation needs. CDK types several of these fields as `any` and passes
 * them through untouched, so a hand-written `singleHeader: { name }` passes
 * synth and fails at deploy; these emit `{ Name }`.
 *
 * Anything else `FieldToMatch` takes — cookies, all headers, the JSON body —
 * CDK types in full, so pass it as an object literal.
 *
 * @see https://docs.aws.amazon.com/waf/latest/APIReference/API_FieldToMatch.html
 */
export const fieldToMatch = {
  /** One header, by name. The name is not case-sensitive. */
  header: (name: string): CfnWebACL.FieldToMatchProperty => ({ singleHeader: { Name: name } }),

  /** One query argument, by name: up to 30 characters, not case-sensitive. */
  queryArgument: (name: string): CfnWebACL.FieldToMatchProperty => {
    validateQueryArgumentName(name);
    return { singleQueryArgument: { Name: name } };
  },

  /** The values of every query argument. */
  allQueryArguments: (): CfnWebACL.FieldToMatchProperty => ({ allQueryArguments: {} }),

  /** The query string: the part of the URL after `?`. */
  queryString: (): CfnWebACL.FieldToMatchProperty => ({ queryString: {} }),

  /** The URI path, such as `/images/logo.png`. */
  uriPath: (): CfnWebACL.FieldToMatchProperty => ({ uriPath: {} }),

  /** The HTTP method. */
  method: (): CfnWebACL.FieldToMatchProperty => ({ method: {} }),

  /**
   * The request body, up to the size WAF inspects. Defaults to WAF's
   * `CONTINUE`, which inspects only what fits; `MATCH` on a blocking rule
   * blocks any body larger than that.
   */
  body: (oversizeHandling?: OversizeHandling): CfnWebACL.FieldToMatchProperty => ({
    body: oversizeHandling === undefined ? {} : { oversizeHandling },
  }),
};

/**
 * Typed rule statements, for `rule.statement()` and `rule.scopeDown()`. Each
 * emits CloudFormation's casing itself and checks WAF's documented limits when
 * it is called, skipping tokens.
 *
 * ```ts
 * rule.statement(ruleStatements.geoMatch(["KP", "IR"]))
 * ```
 */
export const ruleStatements = {
  /**
   * Matches requests from the given countries.
   *
   * @param countryCodes - 1 to 50 ISO 3166-1 alpha-2 codes, such as `GB` (not
   *   `UK`), or `XK` for Kosovo.
   * @param forwardedIp - Locate the client by the IP in a header instead.
   * @see https://docs.aws.amazon.com/waf/latest/APIReference/API_GeoMatchStatement.html
   */
  geoMatch(
    countryCodes: readonly string[],
    forwardedIp?: ForwardedIpOptions,
  ): CfnWebACL.StatementProperty {
    const source = `${API}/API_GeoMatchStatement.html`;
    if (countryCodes.length < 1 || countryCodes.length > MAX_COUNTRY_CODES) {
      fail(
        "geoMatch",
        `a geo match takes 1 to ${String(MAX_COUNTRY_CODES)} country codes, but ${String(countryCodes.length)} were given.`,
        source,
      );
    }
    const unknown = countryCodes.filter((c) => !Token.isUnresolved(c) && !COUNTRY_CODES.has(c));
    if (unknown.length > 0) {
      fail(
        "geoMatch",
        `WAF accepts upper-case ISO 3166-1 alpha-2 country codes, such as "GB", but not ${unknown.map((c) => `"${c}"`).join(", ")}.`,
        source,
      );
    }
    return {
      geoMatchStatement: {
        countryCodes: [...countryCodes],
        ...(forwardedIp && { forwardedIpConfig: forwardedIp }),
      },
    };
  },

  /**
   * Matches requests whose `field` contains `searchString` at `position`, after
   * `transformations`. `ruleStatements.byteMatch(fieldToMatch.uriPath(),
   * "STARTS_WITH", "/admin")` matches the admin paths.
   *
   * @param searchString - 1 to 200 bytes.
   * @param transformations - Applied in order. Defaults to none.
   * @see https://docs.aws.amazon.com/waf/latest/APIReference/API_ByteMatchStatement.html
   */
  byteMatch(
    field: CfnWebACL.FieldToMatchProperty,
    position: ByteMatchPosition,
    searchString: string,
    transformations?: readonly TextTransformationType[],
  ): CfnWebACL.StatementProperty {
    if (!Token.isUnresolved(searchString)) {
      const bytes = new TextEncoder().encode(searchString).length;
      if (bytes < 1 || bytes > MAX_SEARCH_STRING_BYTES) {
        fail(
          "byteMatch",
          `a search string is 1 to ${String(MAX_SEARCH_STRING_BYTES)} bytes, but was ${String(bytes)}.`,
          `${API}/API_ByteMatchStatement.html`,
        );
      }
    }
    return {
      byteMatchStatement: {
        fieldToMatch: field,
        positionalConstraint: position,
        searchString,
        textTransformations: textTransformations("byteMatch", transformations),
      },
    };
  },

  /**
   * Matches requests whose `field`, after `transformations`, compares with
   * `size` bytes by `comparison`. `ruleStatements.sizeConstraint(
   * fieldToMatch.body("MATCH"), "GT", 8192)` matches bodies over 8 KB,
   * including those too large for WAF to inspect.
   *
   * @param size - 0 to 21,474,836,480 bytes.
   * @param transformations - Applied in order. Defaults to none.
   * @see https://docs.aws.amazon.com/waf/latest/APIReference/API_SizeConstraintStatement.html
   */
  sizeConstraint(
    field: CfnWebACL.FieldToMatchProperty,
    comparison: SizeComparison,
    size: number,
    transformations?: readonly TextTransformationType[],
  ): CfnWebACL.StatementProperty {
    if (!Token.isUnresolved(size) && (!Number.isInteger(size) || size < 0 || size > MAX_SIZE)) {
      fail(
        "sizeConstraint",
        `a size is a whole number from 0 to ${MAX_SIZE.toLocaleString("en-US")}, but was ${String(size)}.`,
        `${API}/API_SizeConstraintStatement.html`,
      );
    }
    return {
      sizeConstraintStatement: {
        fieldToMatch: field,
        comparisonOperator: comparison,
        size,
        textTransformations: textTransformations("sizeConstraint", transformations),
      },
    };
  },

  /**
   * Matches requests whose `field`, after `transformations`, matches any
   * pattern in a regex pattern set: by its ARN, or a `ref` to it, such as
   * `ref("patterns", (r) => r.attrArn)`.
   *
   * @param transformations - Applied in order. Defaults to none.
   * @see https://docs.aws.amazon.com/waf/latest/APIReference/API_RegexPatternSetReferenceStatement.html
   */
  regexPatternSet(
    arn: Resolvable<string>,
    field: CfnWebACL.FieldToMatchProperty,
    transformations?: readonly TextTransformationType[],
  ): Resolvable<CfnWebACL.StatementProperty> {
    const textTransformationProps = textTransformations("regexPatternSet", transformations);
    return mapResolvable(arn, (resolved) => ({
      regexPatternSetReferenceStatement: {
        arn: checkArn(resolved),
        fieldToMatch: field,
        textTransformations: textTransformationProps,
      },
    }));
  },

  /**
   * Matches requests from the addresses in an IP set: by its ARN, or a `ref`
   * to it, such as `ref("ips", (r) => r.attrArn)`.
   *
   * @param forwardedIp - Match the address in a header, such as
   *   `X-Forwarded-For`, instead of the one the request came from.
   * @see https://docs.aws.amazon.com/waf/latest/APIReference/API_IPSetReferenceStatement.html
   */
  ipSet(
    arn: Resolvable<string>,
    forwardedIp?: IpSetForwardedIpOptions,
  ): Resolvable<CfnWebACL.StatementProperty> {
    return mapResolvable(arn, (resolved) => ({
      ipSetReferenceStatement: {
        arn: checkArn(resolved),
        ...(forwardedIp && { ipSetForwardedIpConfig: forwardedIp }),
      },
    }));
  },

  /**
   * Matches requests that match every one of `statements`.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statements-logical.html
   */
  and(
    ...statements: Resolvable<CfnWebACL.StatementProperty>[]
  ): Resolvable<CfnWebACL.StatementProperty> {
    return combinator("and", statements, (nested) => ({ andStatement: { statements: nested } }));
  },

  /**
   * Matches requests that match any of `statements`.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statements-logical.html
   */
  or(
    ...statements: Resolvable<CfnWebACL.StatementProperty>[]
  ): Resolvable<CfnWebACL.StatementProperty> {
    return combinator("or", statements, (nested) => ({ orStatement: { statements: nested } }));
  },

  /**
   * Matches requests that do not match `statement`.
   *
   * @see https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statements-logical.html
   */
  not(statement: Resolvable<CfnWebACL.StatementProperty>): Resolvable<CfnWebACL.StatementProperty> {
    return mapResolvable(statement, (nested) => {
      assertNestable("ruleStatements.not()", nested);
      return { notStatement: { statement: nested } };
    });
  },
};

const LOGICAL =
  "https://docs.aws.amazon.com/waf/latest/developerguide/waf-rule-statements-logical.html";

/** Statements that evaluate a rule group, so their rule takes `overrideAction`. */
const RULE_GROUP_STATEMENTS = ["managedRuleGroupStatement", "ruleGroupReferenceStatement"] as const;

/** Statements WAF evaluates only as a rule's own statement, never nested in another. */
const NOT_NESTABLE = ["rateBasedStatement", ...RULE_GROUP_STATEMENTS] as const;

/**
 * Whether `statement` evaluates a rule group, so its rule takes `overrideAction`.
 *
 * @internal
 */
export function isRuleGroupStatement(statement: CfnWebACL.StatementProperty): boolean {
  return RULE_GROUP_STATEMENTS.some((key) => statement[key] !== undefined);
}

/**
 * Throws if `statement` is one WAF cannot nest in another, as a logical or
 * scope-down statement. `where` names the nesting point in the error.
 *
 * @internal
 */
export function assertNestable(where: string, statement: CfnWebACL.StatementProperty): void {
  const kind = NOT_NESTABLE.find((key) => statement[key] !== undefined);
  if (kind !== undefined) {
    throw new Error(
      `${where}: a ${kind} cannot be nested in another statement; give it a rule of its own. See ${LOGICAL}.`,
    );
  }
}

/**
 * Builds an AND or OR statement from `statements` once they are all resolved:
 * at once when none is a ref, otherwise at build.
 */
function combinator(
  method: "and" | "or",
  statements: readonly Resolvable<CfnWebACL.StatementProperty>[],
  build: (nested: CfnWebACL.StatementProperty[]) => CfnWebACL.StatementProperty,
): Resolvable<CfnWebACL.StatementProperty> {
  if (statements.length === 0) {
    fail(method, "a logical statement takes at least one statement.", LOGICAL);
  }
  const checkAndBuild = (resolved: CfnWebACL.StatementProperty[]) => {
    for (const statement of resolved) assertNestable(`ruleStatements.${method}()`, statement);
    return build(resolved);
  };
  if (!statements.some((statement) => isRef(statement))) {
    return checkAndBuild(statements as CfnWebACL.StatementProperty[]);
  }
  // combine() takes a record, so key the statements by position; integer keys keep their order.
  const byIndex = Object.fromEntries(statements.map((statement, i) => [String(i), statement]));
  return combine(byIndex, (resolved) => checkAndBuild(Object.values(resolved)));
}

function checkArn(arn: string): string {
  validateReferenceArn(arn);
  return arn;
}

/** Copied from `@composurecdk/ses`'s actions, which inline the same mapping. */
function mapResolvable<T, U>(value: Resolvable<T>, transform: (value: T) => U): Resolvable<U> {
  return isRef(value) ? value.map(transform) : transform(value);
}
