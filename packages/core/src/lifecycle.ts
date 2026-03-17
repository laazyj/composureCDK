import { type IConstruct } from "constructs";

/**
 * Base type for the dependency context passed to a component's {@link Lifecycle.build} method.
 * A record of named dependencies, each being a record of their build outputs.
 */
type LifecycleComponentBase = Record<string, object>;

/**
 * The core interface for all ComposureCDK components. A `Lifecycle` represents
 * a unit of infrastructure that can be built within a CDK construct tree.
 *
 * Components implement this interface to define what resources they create
 * and what dependencies they require. The {@link compose} function assembles
 * components into a system, resolving dependencies and invoking `build` in
 * the correct order.
 *
 * @typeParam T - The record of resources and values this component produces when built.
 * @typeParam Context - The resolved dependencies this component requires, keyed by component name.
 */
export interface Lifecycle<
  T extends object = object,
  Context extends LifecycleComponentBase = LifecycleComponentBase,
> {
  build(scope: IConstruct, id: string, context?: Context): T;
}
