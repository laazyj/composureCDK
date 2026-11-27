import { type Stack } from "aws-cdk-lib";
import { applyTagsToConstruct } from "./apply-builder-tags.js";
import { validateTagRecord } from "./tag-validator.js";

/**
 * Tags a Stack the app built itself the way
 * {@link createStackBuilder}'s `.tags()` tags the Stack it builds: the Stack
 * itself and every resource in it, whether or not
 * `@aws-cdk/core:explicitStackTags` is set, at the same priority.
 *
 * Use it for a Stack no builder can make, such as a deployment framework's
 * own `Stack` subclass.
 *
 * Keys and values are validated as `.tag()` validates them, and an invalid
 * one throws before any tag is applied.
 *
 * @param stack - The Stack to tag.
 * @param tags - The tags, by key.
 *
 * @example
 * ```ts
 * const stack = new FrameworkStack(app, "Api", { env });
 * tagStack(stack, { app: "MyApp", team: "platform" });
 * ```
 */
export function tagStack(stack: Stack, tags: Record<string, string>): void {
  validateTagRecord(tags);
  applyTagsToConstruct(stack, Object.entries(tags));
}
