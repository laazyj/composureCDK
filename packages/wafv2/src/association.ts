import { Stack } from "aws-cdk-lib";
import type { Stage } from "aws-cdk-lib/aws-apigateway";
import { CfnWebACLAssociation, type CfnWebACLAssociationProps } from "aws-cdk-lib/aws-wafv2";
import { Construct, type IConstruct } from "constructs";

/**
 * A resource a regional web ACL can protect: an ARN, a CDK reference CDK
 * itself accepts (an Application Load Balancer, an AppSync API, …), or an API
 * Gateway REST API stage.
 *
 * The ARN and reference types are read from CDK's own `resourceArn` prop, so
 * they track the installed `aws-cdk-lib` (ADR-0018).
 */
export type WebAclAssociationTarget =
  NonNullable<CfnWebACLAssociationProps["resourceArn"]> | Pick<Stage, "stageArn" | "node">;

function isStage(target: WebAclAssociationTarget): target is Pick<Stage, "stageArn" | "node"> {
  return typeof target === "object" && "stageArn" in target;
}

/** 32-bit FNV-1a, as 8 hex digits. */
function fnv1a(value: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash = Math.imul(hash ^ value.charCodeAt(i), 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * A construct id suffix that follows the target, not its position: an id that
 * moved when another target was removed would replace the association, and
 * CloudFormation deletes the old one last, disassociating the resource.
 */
function targetKey(scope: IConstruct, target: WebAclAssociationTarget): string {
  const identity = Construct.isConstruct(target)
    ? target.node.path
    : JSON.stringify(Stack.of(scope).resolve(target));
  return fnv1a(identity);
}

/**
 * Creates one `AWS::WAFv2::WebACLAssociation` per target, each depending on
 * the one before it: AWS allows one `AssociateWebACL` call every two seconds
 * per account and Region, so parallel associations throttle themselves.
 *
 * @internal
 */
export function associate(
  scope: IConstruct,
  id: string,
  webAclArn: string,
  targets: WebAclAssociationTarget[],
): CfnWebACLAssociation[] {
  const associations: CfnWebACLAssociation[] = [];
  const seen = new Set<string>();
  for (const target of targets) {
    const resourceArn = isStage(target) ? target.stageArn : target;
    const key = targetKey(scope, target);
    if (seen.has(key)) {
      throw new Error(`WebAclBuilder "${id}": associateWith() was given the same resource twice.`);
    }
    seen.add(key);
    const association = new CfnWebACLAssociation(scope, `${id}Association${key}`, {
      webAclArn,
      resourceArn,
    });
    // The ARN references the resource, which already orders the association
    // after it; a construct is depended on explicitly in case it does not.
    if (Construct.isConstruct(target)) association.node.addDependency(target);
    const previous = associations.at(-1);
    if (previous) association.node.addDependency(previous);
    associations.push(association);
  }
  return associations;
}
