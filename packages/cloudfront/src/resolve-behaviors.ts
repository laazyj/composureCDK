import {
  type AddBehaviorOptions,
  type BehaviorOptions,
  Function as CfFunction,
  type FunctionAssociation,
  type FunctionEventType,
  type FunctionProps,
  FunctionRuntime,
  type IOrigin,
} from "aws-cdk-lib/aws-cloudfront";
import type { IConstruct } from "constructs";
import { resolve } from "@composurecdk/core";
import type { AlarmDefinition } from "@composurecdk/cloudwatch";
import {
  behaviorFunctionKeyPrefix,
  eventTypePascal,
  pathPatternSlug,
  resolveBehaviorFunctionAlarmDefinitions,
} from "./behavior-function-alarms.js";
import { INLINE_FUNCTION_DEFAULTS } from "./defaults.js";
import type {
  AdditionalBehaviorConfig,
  DefaultBehaviorConfig,
  InlineFunctionDefinition,
} from "./distribution-builder.js";

/**
 * Input required to resolve the default behavior, all additional behaviors,
 * and any inline CloudFront Functions into concrete CDK objects.
 */
export interface ResolveBehaviorsInput {
  /** The construct scope under which functions and behaviors are created. */
  scope: IConstruct;

  /** The distribution's construct id — used as a prefix for Function ids. */
  id: string;

  /** Compose context forwarded to {@link resolve}. Empty record if unused. */
  context: Record<string, object>;

  /** The already-resolved default origin. */
  defaultOrigin: IOrigin;

  /** User-provided default-behavior config (may be undefined). */
  defaultBehavior: DefaultBehaviorConfig | undefined;

  /** The builder's default-behavior defaults, applied before user props. */
  defaultBehaviorDefaults: Partial<AddBehaviorOptions>;

  /**
   * Ordered map of path-pattern → config for additional behaviors. Origins
   * are resolved here via {@link resolve}.
   */
  additionalBehaviors: Map<string, AdditionalBehaviorConfig>;
}

/**
 * Output of {@link resolveBehaviors}: concrete behavior options ready to pass
 * to the CDK `Distribution` constructor, plus any owned {@link CfFunction}
 * instances and their alarm definitions.
 */
export interface ResolveBehaviorsResult {
  /** Concrete `BehaviorOptions` for the default cache behavior. */
  defaultBehavior: BehaviorOptions;

  /** Concrete `BehaviorOptions` keyed by path pattern, in insertion order. */
  additionalBehaviors: Record<string, BehaviorOptions>;

  /**
   * Owned inline CloudFront Functions, keyed by
   * `<behaviorScope><EventType>` — e.g. `defaultBehaviorViewerRequest`.
   */
  functions: Record<string, CfFunction>;

  /** Alarm definitions for the owned inline functions. */
  alarmDefinitions: AlarmDefinition[];
}

function scopeLabel(pathPattern: string | null): string {
  return pathPattern === null ? "default behavior" : `behavior "${pathPattern}"`;
}

function behaviorIdScope(pathPattern: string | null): string {
  return pathPattern === null ? "DefaultBehavior" : `Behavior${pathPatternSlug(pathPattern)}`;
}

function assertUniqueEventTypes(
  functions: InlineFunctionDefinition[],
  pathPattern: string | null,
): void {
  const seen = new Set<FunctionEventType>();
  for (const fn of functions) {
    if (seen.has(fn.eventType)) {
      throw new Error(
        `DistributionBuilder: ${scopeLabel(pathPattern)} has multiple functions for eventType "${fn.eventType}". ` +
          `CloudFront allows at most one function per event type per behavior.`,
      );
    }
    seen.add(fn.eventType);
  }
}

function assertKeyValueStoreRuntime(
  def: InlineFunctionDefinition,
  pathPattern: string | null,
): void {
  if (!def.keyValueStore) return;
  const effectiveRuntime = def.runtime ?? INLINE_FUNCTION_DEFAULTS.runtime;
  if (effectiveRuntime !== FunctionRuntime.JS_2_0) {
    throw new Error(
      `DistributionBuilder: ${scopeLabel(pathPattern)} function (${def.eventType}) uses a ` +
        `keyValueStore, which requires FunctionRuntime.JS_2_0.`,
    );
  }
}

/**
 * Materializes the default and additional cache behaviors into CDK-ready
 * `BehaviorOptions`, creating any inline CloudFront Functions along the way
 * and producing their path-scoped alarm definitions.
 *
 * Enforces CloudFront invariants at configure time: at most one function per
 * event type per behavior, and `keyValueStore` requires `FunctionRuntime.JS_2_0`.
 */
export function resolveBehaviors(input: ResolveBehaviorsInput): ResolveBehaviorsResult {
  const { scope, id, context, defaultOrigin, defaultBehavior, defaultBehaviorDefaults } = input;

  const functions: Record<string, CfFunction> = {};
  const alarmDefinitions: AlarmDefinition[] = [];

  const buildInlineFunctions = (
    pathPattern: string | null,
    definitions: InlineFunctionDefinition[] | undefined,
  ): FunctionAssociation[] => {
    if (!definitions || definitions.length === 0) return [];
    assertUniqueEventTypes(definitions, pathPattern);
    const scopeId = behaviorIdScope(pathPattern);
    const associations: FunctionAssociation[] = [];
    for (const def of definitions) {
      assertKeyValueStoreRuntime(def, pathPattern);
      const { eventType, recommendedAlarms, ...rest } = def;
      const fnId = `${id}${scopeId}${eventTypePascal(eventType)}Fn`;
      const fn = new CfFunction(scope, fnId, {
        ...INLINE_FUNCTION_DEFAULTS,
        ...rest,
      } as FunctionProps);
      functions[behaviorFunctionKeyPrefix(pathPattern, eventType)] = fn;
      associations.push({ function: fn, eventType });
      alarmDefinitions.push(
        ...resolveBehaviorFunctionAlarmDefinitions(pathPattern, eventType, fn, recommendedAlarms),
      );
    }
    return associations;
  };

  const defaultAssociations = buildInlineFunctions(null, defaultBehavior?.functions);
  const { functions: _defaultInlineFns, ...userDefaultBehavior } = defaultBehavior ?? {};
  void _defaultInlineFns;

  const resolvedDefaultBehavior: BehaviorOptions = {
    ...defaultBehaviorDefaults,
    ...userDefaultBehavior,
    ...(defaultAssociations.length > 0 ? { functionAssociations: defaultAssociations } : {}),
    origin: defaultOrigin,
  };

  const resolvedAdditionalBehaviors: Record<string, BehaviorOptions> = {};
  for (const [pathPattern, config] of input.additionalBehaviors) {
    const resolvedOrigin = resolve(config.origin, context);
    const associations = buildInlineFunctions(pathPattern, config.functions);
    const { functions: _inlineFns, origin: _origin, ...rest } = config;
    void _inlineFns;
    void _origin;
    resolvedAdditionalBehaviors[pathPattern] = {
      ...rest,
      origin: resolvedOrigin,
      ...(associations.length > 0 ? { functionAssociations: associations } : {}),
    };
  }

  return {
    defaultBehavior: resolvedDefaultBehavior,
    additionalBehaviors: resolvedAdditionalBehaviors,
    functions,
    alarmDefinitions,
  };
}
