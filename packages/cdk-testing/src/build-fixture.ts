import { type Stack, type StackProps } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import type { Lifecycle } from "@composurecdk/core";
import { newStack } from "./stack.js";

/** What a bound fixture returns. */
export interface BuildAndSynth<B extends Lifecycle> {
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

/** What a fixture fixes for every call it makes. */
export interface FixtureOptions<B> {
  /** Applied to every call, unless the call passes its own. */
  readonly stackProps?: StackProps;
  /**
   * Applied to every builder before `configure`, for setup the whole suite
   * shares. Use it where that setup needs the stack — a hosted zone to
   * validate a certificate against, say. Where it does not, seed inside
   * `factory` instead.
   */
  readonly seed?: (builder: B, stack: Stack) => void;
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
 * @param factory - Makes the builder under test. Called with **no arguments**,
 *   deliberately: several `create*Builder` functions take an optional first
 *   parameter (`createQueueBuilder(role)`), and a factory that received the
 *   stack would silently pass it as that argument. TypeScript cannot catch
 *   that — a one-parameter function is assignable to a zero-parameter
 *   signature — so the call site must stay zero-argument. Seed the builder
 *   inline (`() => createTableBuilder().partitionKey(PK)`), or with `seed`
 *   where the stack is needed.
 * @param id - The construct id to build under.
 * @param fixture - Applied to every call. A call can pass its own
 *   `stackProps`, which replaces the fixture's.
 *
 * @example
 * ```ts
 * const buildAndSynth = buildFixture(createQueueBuilder, "TestQueue");
 *
 * const { template } = buildAndSynth((b) => b.fifo(true));
 * const { result } = buildAndSynth((b) => b.recommendedAlarms(true));
 * ```
 */
export function buildFixture<B extends Lifecycle>(
  factory: () => B,
  id: string,
  fixture: FixtureOptions<B> = {},
): (
  configure?: (builder: B, stack: Stack) => void,
  options?: BuildAndSynthOptions,
) => BuildAndSynth<B> {
  return (configure, options = {}) => {
    const { stackProps = fixture.stackProps, context } = options;
    const stack = newStack(stackProps);
    const builder = factory();
    fixture.seed?.(builder, stack);
    configure?.(builder, stack);
    const result = builder.build(stack, id, context) as ReturnType<B["build"]>;
    return { result, template: Template.fromStack(stack), stack };
  };
}
