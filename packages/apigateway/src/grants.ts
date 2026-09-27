import type { IRestApi } from "aws-cdk-lib/aws-apigateway";
import { Grant as IamGrant, type IGrantable } from "aws-cdk-lib/aws-iam";
import { type Grant, grantVia, type Resolvable } from "@composurecdk/core";

/**
 * Narrows an {@link restApiGrants.invoke} grant to part of an API's execute-api
 * ARN. Each field defaults to `*` (all matching), so an empty scope grants
 * invoke across the whole API.
 *
 * @see {@link https://docs.aws.amazon.com/apigateway/latest/developerguide/api-gateway-control-access-using-iam-policies-to-invoke-api.html | Control access for invoking an API}
 */
export interface RestApiInvokeScope {
  /** HTTP method to allow (e.g. `"GET"`), or `"*"` for any. Defaults to `*`. */
  method?: string;
  /** Resource path to allow (e.g. `"/items/*"`), or `"*"` for any. Defaults to `*`. */
  path?: string;
  /** Deployment stage to allow (e.g. `"prod"`), or `"*"` for any. Defaults to `*`. */
  stage?: string;
}

/**
 * Consumer-side grant helpers for *invoking* an API Gateway REST API. Pass one
 * to a grantee builder's `grant(...)` so that grantee may call the API — e.g.
 * `role.grant(restApiGrants.invoke(ref("api", (r) => r.api)))`.
 *
 * `IRestApi` is implemented by both `RestApi` and `SpecRestApi`, so this serves
 * either builder's result. See ADR-0013.
 */
export const restApiGrants = {
  /**
   * Invoke the API (`execute-api:Invoke`). By default the grant covers the whole
   * API (all methods, paths, and stages); pass a {@link RestApiInvokeScope} to
   * narrow it to a specific method, path, and/or stage.
   */
  invoke: (api: Resolvable<IRestApi>, scope: RestApiInvokeScope = {}): Grant<IGrantable> =>
    grantVia(api, (restApi, grantee) => {
      IamGrant.addToPrincipal({
        grantee,
        actions: ["execute-api:Invoke"],
        resourceArns: [restApi.arnForExecuteApi(scope.method, scope.path, scope.stage)],
      });
    }),
};
