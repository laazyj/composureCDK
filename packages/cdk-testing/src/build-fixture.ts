import type { IConstruct } from "constructs";
import { type Stack, type StackProps } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { newStack } from "./stack.js";

/** The slice of a builder's surface this fixture uses. */
interface Buildable {
  build(scope: IConstruct, id: string, context?: Record<string, object>): unknown;
}

/** What a bound fixture returns. */
export interface BuildAndSynth<B extends Buildable> {
  /** The builder's own result — alarms, refs, the construct it created. */
  readonly result: ReturnType<B["build"]>;
  /** The synthesised template, for `hasResourceProperties` and friends. */
  readonly template: Template;
  /** The stack the builder built into, for assertions about the scope itself. */
  readonly stack: Stack;
}

/** Per-call overrides, for the one test in a file that needs different setup. */
export interface BuildAndSynthOptions {
  /**
   * Replaces — not merges with — the props the fixture was created with. Pass
   * `{}` for an environment-agnostic stack where the fixture supplies an `env`.
   */
  readonly stackProps?: StackProps;
  /** Forwarded as `build`'s third argument. */
  readonly context?: Record<string, object>;
}

/**
 * Binds a builder factory and construct id into a reusable
 * build-and-synthesise fixture — the shape nine packages had each written for
 * themselves, under two names (`synthTemplate` and `buildResult`).
 *
 * The returned function creates a stack, makes a builder, applies the
 * `configure` callback, builds, and returns the result alongside the
 * synthesised template.
 *
 * It is curried because the factory and id are fixed per suite while the
 * configure callback varies per test — so binding once keeps ~400 call sites
 * to their single meaningful argument.
 *
 * @param factory - Makes the builder under test. Receives the stack, for a
 *   suite that must seed the builder with a construct in it (a hosted zone to
 *   validate against, say).
 * @param id - The construct id to build under.
 * @param defaults - Applied to every call, unless a call overrides them.
 *
 * @example
 * ```ts
 * const buildAndSynth = buildFixture(createQueueBuilder, "TestQueue");
 *
 * const { template } = buildAndSynth((b) => b.fifo(true));
 * const { result } = buildAndSynth((b) => b.recommendedAlarms(true));
 * ```
 */
export function buildFixture<B extends Buildable>(
  factory: (stack: Stack) => B,
  id: string,
  defaults: BuildAndSynthOptions = {},
): (
  configure?: (builder: B, stack: Stack) => void,
  options?: BuildAndSynthOptions,
) => BuildAndSynth<B> {
  return (configure, options = {}) => {
    const { stackProps = defaults.stackProps, context = defaults.context } = options;
    const stack = newStack(stackProps);
    const builder = factory(stack);
    configure?.(builder, stack);
    const result = builder.build(stack, id, context) as ReturnType<B["build"]>;
    return { result, template: Template.fromStack(stack), stack };
  };
}
