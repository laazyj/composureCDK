import { HEALTHY_STATUSES, listExampleStacks, STACK_PREFIX } from "./_helpers.mjs";

export default {
  name: "Stack health",
  run: async ({ aws, pass, fail }) => {
    const stacks = listExampleStacks(aws);
    if (stacks.length === 0) {
      fail(`No stacks found with prefix ${STACK_PREFIX}`);
      return;
    }
    for (const { StackName, StackStatus } of stacks) {
      if (HEALTHY_STATUSES.has(StackStatus)) {
        pass(`${StackName} — ${StackStatus}`);
      } else {
        fail(`${StackName} — ${StackStatus}`);
      }
    }
  },
};
