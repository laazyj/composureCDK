import { ApiDefinition } from "aws-cdk-lib/aws-apigateway";
import { combine, type Ref, type Resolvable } from "@composurecdk/core";

/** Escapes a string the way JSON would, for splicing into a serialised document. */
function forJson(value: string): string {
  return JSON.stringify(value).slice(1, -1);
}

function forRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replaces each placeholder in a specification with its value, returning a new
 * document. The caller's object is not modified.
 *
 * The substitution runs over the serialised document, so a placeholder is
 * replaced wherever it appears — an integration URI, a credentials field, a
 * mapping template — without this function needing to know the shape of an
 * OpenAPI document. It is a literal string replacement and imposes no
 * placeholder syntax: `${Function.Arn}`, `{{functionArn}}` and
 * `__FUNCTION_ARN__` all work. It is *only* a string replacement, so a
 * placeholder that also occurs as an object key rewrites that key.
 *
 * All placeholders are matched in one pass, longest first, so no placeholder
 * can be destroyed by another that is a prefix of it.
 *
 * A placeholder that appears nowhere in the document throws: it is almost
 * always a typo, and the value it stood for would silently go unused. Note
 * this cannot catch the reverse — a placeholder *in the document* that the
 * caller never mapped is not detectable without imposing a syntax, and will
 * deploy verbatim.
 *
 * @param spec - The specification, as a JSON-serialisable object.
 * @param values - Placeholder to replacement value.
 * @returns A new specification with the placeholders replaced.
 */
export function substituteSpec(spec: object, values: Record<string, string>): object {
  const json = JSON.stringify(spec);
  const entries = Object.entries(values).map(([placeholder, value]) => ({
    placeholder,
    search: forJson(placeholder),
    replacement: forJson(value),
  }));

  const missing = entries.filter(({ search }) => !json.includes(search));
  if (missing.length > 0) {
    const names = missing.map(({ placeholder }) => `"${placeholder}"`).join(", ");
    throw new Error(
      `substituteSpec: ${names} ${missing.length === 1 ? "appears" : "appear"} nowhere in the specification.`,
    );
  }

  // An empty alternation would match the empty string everywhere.
  if (entries.length === 0) {
    return JSON.parse(json) as object;
  }

  const ordered = [...entries].sort((a, b) => b.search.length - a.search.length);
  const pattern = new RegExp(ordered.map(({ search }) => forRegExp(search)).join("|"), "g");
  const replacements: Record<string, string> = Object.fromEntries(
    ordered.map(({ search, replacement }) => [search, replacement]),
  );

  // Every match came from `pattern`, which was built from these same keys.
  return JSON.parse(json.replace(pattern, (match) => replacements[match])) as object;
}

/**
 * Builds an inline {@link ApiDefinition} from a specification whose
 * placeholders stand for resources built by sibling components.
 *
 * A model-first specification names the resources its integrations call before
 * those resources exist, so it refers to them by placeholder. Each placeholder
 * maps to a {@link Resolvable} — usually a `ref` into a sibling — and the
 * definition is completed once they resolve. This is `combine` plus
 * {@link substituteSpec} plus `ApiDefinition.fromInline`, in one call; reach
 * for those directly when the definition is not an inline document or the
 * substitution is not a string replacement.
 *
 * @param spec - The specification, as a JSON-serialisable object.
 * @param placeholders - Placeholder to the value that replaces it, concrete or
 *   a `ref` resolved at build time.
 * @returns A `Ref` to the completed definition, for the spec builder's
 *   `apiDefinition`.
 *
 * @example
 * ```ts
 * createSpecRestApiBuilder()
 *   .restApiName("PetStore")
 *   .apiDefinition(inlineSpecDefinition(petstoreSpec, {
 *     "${PetFunction.Arn}": ref("handler", (r: FunctionBuilderResult) => r.function.functionArn),
 *     "${ApiGatewayRole.Arn}": ref("gatewayRole", (r: RoleBuilderResult) => r.role.roleArn),
 *   }));
 * ```
 */
export function inlineSpecDefinition(
  spec: object,
  placeholders: Record<string, Resolvable<string>>,
): Ref<ApiDefinition> {
  return combine(placeholders, (values) => ApiDefinition.fromInline(substituteSpec(spec, values)));
}
