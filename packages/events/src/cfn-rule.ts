import { CfnResource } from "aws-cdk-lib";
import { CfnRule } from "aws-cdk-lib/aws-events";
import type { IConstruct } from "constructs";

/** Narrows to an `AWS::Events::Rule` L1 without `instanceof` — see ADR-0007/ADR-0011. */
export function isCfnRule(node: IConstruct | undefined): node is CfnRule {
  return (
    node !== undefined &&
    CfnResource.isCfnResource(node) &&
    node.cfnResourceType === CfnRule.CFN_RESOURCE_TYPE_NAME
  );
}
