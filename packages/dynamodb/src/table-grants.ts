import type { IGrantable } from "aws-cdk-lib/aws-iam";
import { resolve, type Resolvable } from "@composurecdk/core";

/**
 * The subset of {@link Table} / {@link TableV2}'s grant methods the table
 * builders expose declaratively. Both classes implement this shape, so the
 * queue below works identically for either.
 */
export interface GrantableTable {
  grantReadData(grantee: IGrantable): unknown;
  grantWriteData(grantee: IGrantable): unknown;
  grantReadWriteData(grantee: IGrantable): unknown;
}

interface PendingGrant {
  principal: Resolvable<IGrantable>;
  apply: (table: GrantableTable, grantee: IGrantable) => void;
}

/**
 * Queues cross-component IAM grants declared before the table exists (e.g.
 * `.grantReadWriteData(ref("apiRole", r => r.role))`), then applies them
 * during the table builder's own {@link Lifecycle.build}, once `principal`
 * has resolved to a concrete {@link IGrantable}.
 *
 * This keeps grants declared as data alongside the rest of a component's
 * configuration — the same shape as {@link Resolvable} everywhere else in
 * ComposureCDK — rather than pushed out to an imperative `afterBuild` hook.
 */
export class TableGrants {
  readonly #pending: PendingGrant[] = [];

  add(principal: Resolvable<IGrantable>, apply: PendingGrant["apply"]): void {
    this.#pending.push({ principal, apply });
  }

  /** @internal — see ADR-0005. */
  copyInto(target: TableGrants): void {
    target.#pending.push(...this.#pending);
  }

  applyTo(table: GrantableTable, context: Record<string, object> = {}): void {
    for (const { principal, apply } of this.#pending) {
      apply(table, resolve(principal, context));
    }
  }
}
