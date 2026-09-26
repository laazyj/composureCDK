import { Stack } from "aws-cdk-lib";
import type { IConstruct } from "constructs";

/**
 * The synth-time-literal segments that identify `scope`'s stack: the stack's
 * name or, inside a nested stack, the top-level stack's name followed by each
 * nested stack's construct id.
 *
 * A nested stack's own `stackName` is a token CloudFormation fills in at deploy
 * time with a generated name, so a physical name built from it is unreadable in
 * the template and escapes synth-time validation. Use this instead whenever a
 * default physical name is scoped to its stack; join the segments as the
 * target name format requires.
 */
export function stackNameSegments(scope: IConstruct): string[] {
  const stack = Stack.of(scope);
  const parent = stack.nestedStackParent;
  return parent ? [...stackNameSegments(parent), stack.node.id] : [stack.stackName];
}
