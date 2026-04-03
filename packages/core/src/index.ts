export { Builder, type IBuilder } from "./builder.js";
export {
  compose,
  type ComposedSystem,
  type ConfiguredSystem,
  type AfterBuildHook,
} from "./compose.js";
export { CyclicDependencyError } from "./cyclic-dependency-error.js";
export { type Lifecycle } from "./lifecycle.js";
export { Ref, ref, resolve, isRef, type Resolvable } from "./ref.js";
export {
  type StackStrategy,
  type ScopeFactory,
  singleStack,
  groupedStacks,
} from "./stack-strategy.js";
