import type { IGrantable } from "aws-cdk-lib/aws-iam";
import type { IFunction } from "aws-cdk-lib/aws-lambda";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/** Wraps one of {@link IFunction}'s native grant methods as a capability helper. */
const capability =
  (apply: (fn: IFunction, grantee: IGrantable) => void) =>
  (fn: Resolvable<IFunction>): Grant<IGrantable> =>
    grantVia(fn, apply);

/**
 * Consumer-side grant helpers for *invoking* a Lambda function. Pass one to a
 * grantee builder's `grant(...)` so that grantee may call the function — e.g.
 * `role.grant(functionGrants.invoke(ref("handler", (r) => r.function)))`.
 *
 * Note the direction: here the function is the **resource** being invoked and
 * the grantee is the caller. This is the mirror of
 * `createFunctionBuilder().grant(...)`, where the function is the **grantee**
 * receiving access to some other resource — a Lambda `Function` is both. Each
 * delegates to the function's native `grant*` method. See ADR-0013.
 */
export const functionGrants = {
  /** Invoke the function (`lambda:InvokeFunction`). */
  invoke: capability((fn, grantee) => {
    fn.grantInvoke(grantee);
  }),
  /** Invoke the function through its function URL (`lambda:InvokeFunctionUrl`). */
  invokeUrl: capability((fn, grantee) => {
    fn.grantInvokeUrl(grantee);
  }),
};
