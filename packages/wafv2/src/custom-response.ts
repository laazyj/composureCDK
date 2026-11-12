import { Token } from "aws-cdk-lib";
import type { CfnWebACL } from "aws-cdk-lib/aws-wafv2";

/**
 * The body of a custom response. `json` is serialised with `JSON.stringify`
 * unless it is already a string.
 */
export type CustomResponseBody = { json: unknown } | { text: string } | { html: string };

/** A custom response for a Block action: status, optional body and headers. */
export interface CustomResponse {
  readonly status: number;
  readonly body?: CustomResponseBody;
  readonly headers?: Record<string, string>;
}

const SOURCE =
  "https://docs.aws.amazon.com/waf/latest/developerguide/customizing-the-response-status-codes.html";
const QUOTAS = "https://docs.aws.amazon.com/waf/latest/developerguide/limits.html";

/**
 * The status codes WAF accepts in a custom response. `410` is not among them,
 * and `402` is reserved for the Monetize action.
 *
 * @see https://docs.aws.amazon.com/waf/latest/developerguide/customizing-the-response-status-codes.html
 */
export const SUPPORTED_CUSTOM_RESPONSE_STATUS_CODES: readonly number[] = [
  200, 201, 202, 204, 206, 300, 301, 302, 303, 304, 307, 308, 400, 401, 403, 404, 405, 408, 409,
  411, 412, 413, 414, 415, 416, 421, 429, 500, 501, 502, 503, 504, 505,
];

const MAX_BODY_BYTES = 4 * 1024;
const MAX_BODIES = 50;
const MAX_TOTAL_BODY_BYTES = 50 * 1024;
const MAX_HEADERS = 10;
const HEADER_NAME = /^[a-zA-Z0-9._$-]{1,64}$/;

const encoder = new TextEncoder();
const byteLength = (s: string): number => encoder.encode(s).length;

function toBodyProperty(body: CustomResponseBody): CfnWebACL.CustomResponseBodyProperty {
  if ("json" in body) {
    return {
      contentType: "APPLICATION_JSON",
      content: typeof body.json === "string" ? body.json : JSON.stringify(body.json),
    };
  }
  if ("text" in body) return { contentType: "TEXT_PLAIN", content: body.text };
  return { contentType: "TEXT_HTML", content: body.html };
}

function validateStatus(owner: string, status: number): void {
  if (Token.isUnresolved(status)) return;
  if (!SUPPORTED_CUSTOM_RESPONSE_STATUS_CODES.includes(status)) {
    throw new Error(
      `${owner}: AWS WAF does not support the custom response status code ${String(status)}. ` +
        `Supported: ${SUPPORTED_CUSTOM_RESPONSE_STATUS_CODES.join(", ")}. See ${SOURCE}.`,
    );
  }
}

function validateHeaders(owner: string, headers: Record<string, string>): void {
  const names = Object.keys(headers);
  if (names.length > MAX_HEADERS) {
    throw new Error(
      `${owner}: a custom response can set at most ${String(MAX_HEADERS)} headers, but ${String(names.length)} were given. See ${QUOTAS}.`,
    );
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (!HEADER_NAME.test(name)) {
      throw new Error(
        `${owner}: custom response header "${name}" is invalid. Names are 1–64 characters of letters, digits and ._$-. See ${SOURCE}.`,
      );
    }
    const lower = name.toLowerCase();
    if (lower === "content-type") {
      throw new Error(
        `${owner}: a custom response cannot set content-type; WAF sets it from the body's type. Use { json }, { text } or { html } instead.`,
      );
    }
    if (seen.has(lower)) {
      throw new Error(`${owner}: custom response header "${name}" is set twice.`);
    }
    seen.add(lower);
  }
}

/**
 * Collects the custom response bodies of a web ACL's default action and rules
 * into the ACL-level `CustomResponseBodies` map CloudFormation requires.
 * Identical bodies share one key; a body's key is derived from the first rule
 * that uses it.
 *
 * @internal
 */
export class CustomResponseBodies {
  readonly #owner: string;
  readonly #bodies: Record<string, CfnWebACL.CustomResponseBodyProperty> = {};
  readonly #keysByContent = new Map<string, string>();
  #totalBytes = 0;

  constructor(owner: string) {
    this.#owner = owner;
  }

  /**
   * Validates `response` and turns it into the `CustomResponse` CloudFormation
   * expects, registering its body under a key derived from `keyHint`.
   *
   * @param who - Names the rule or default action in error messages.
   */
  register(
    who: string,
    keyHint: string,
    response: CustomResponse,
  ): CfnWebACL.CustomResponseProperty {
    const owner = `${this.#owner} ${who}`;
    validateStatus(owner, response.status);
    if (response.headers) validateHeaders(owner, response.headers);

    const responseHeaders = response.headers
      ? Object.entries(response.headers).map(([name, value]) => ({ name, value }))
      : undefined;

    return {
      responseCode: response.status,
      ...(response.body && { customResponseBodyKey: this.#keyFor(owner, keyHint, response.body) }),
      ...(responseHeaders && { responseHeaders }),
    };
  }

  #keyFor(owner: string, keyHint: string, body: CustomResponseBody): string {
    const property = toBodyProperty(body);
    const identity = `${property.contentType}\n${property.content}`;
    const existing = this.#keysByContent.get(identity);
    if (existing !== undefined) return existing;

    const bytes = byteLength(property.content);
    if (bytes > MAX_BODY_BYTES) {
      throw new Error(
        `${owner}: the custom response body is ${String(bytes)} bytes; AWS WAF allows at most ${String(MAX_BODY_BYTES)}. See ${QUOTAS}.`,
      );
    }
    if (this.#keysByContent.size >= MAX_BODIES) {
      throw new Error(
        `${this.#owner}: a web ACL can hold at most ${String(MAX_BODIES)} distinct custom response bodies. See ${QUOTAS}.`,
      );
    }
    this.#totalBytes += bytes;
    if (this.#totalBytes > MAX_TOTAL_BODY_BYTES) {
      throw new Error(
        `${this.#owner}: the custom response bodies total ${String(this.#totalBytes)} bytes; AWS WAF allows at most ${String(MAX_TOTAL_BODY_BYTES)} per web ACL. See ${QUOTAS}.`,
      );
    }

    let key = keyHint;
    // Keys share the 128-character limit of rule names, so leave room for a suffix.
    for (let n = 2; key in this.#bodies; n++) key = `${keyHint.slice(0, 120)}-${String(n)}`;
    this.#bodies[key] = property;
    this.#keysByContent.set(identity, key);
    return key;
  }

  /**
   * The Block action for a rule or default action, with `response` as its
   * custom response when there is one.
   */
  block(who: string, keyHint: string, response?: CustomResponse): CfnWebACL.BlockActionProperty {
    return response ? { customResponse: this.register(who, keyHint, response) } : {};
  }

  /** The map for `CfnWebACLProps.customResponseBodies`, or `undefined` when empty. */
  toProperty(): Record<string, CfnWebACL.CustomResponseBodyProperty> | undefined {
    return this.#keysByContent.size > 0 ? this.#bodies : undefined;
  }
}
