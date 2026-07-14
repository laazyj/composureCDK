import { describe, expect, it } from "vitest";
import {
  type ActivationEvent,
  type SesActivationApi,
  runActivation,
} from "../src/activation-handler.js";

/** A fake SES API that records `setActive` calls and reports a fixed active set. */
function fakeApi(activeRuleSetName?: string) {
  const setActiveCalls: (string | undefined)[] = [];
  const api: SesActivationApi = {
    getActiveRuleSetName: () => Promise.resolve(activeRuleSetName),
    setActive: (name) => {
      setActiveCalls.push(name);
      return Promise.resolve();
    },
  };
  return { api, setActiveCalls };
}

const event = (
  RequestType: ActivationEvent["RequestType"],
  RuleSetName = "rs",
): ActivationEvent => ({
  RequestType,
  ResourceProperties: { RuleSetName },
});

describe("runActivation", () => {
  it("activates the rule set on create", async () => {
    const { api, setActiveCalls } = fakeApi();
    const result = await runActivation(event("Create"), api);
    expect(setActiveCalls).toEqual(["rs"]);
    expect(result.PhysicalResourceId).toBe("ses-active-rule-set-rs");
  });

  it("activates the rule set on update", async () => {
    const { api, setActiveCalls } = fakeApi();
    await runActivation(event("Update"), api);
    expect(setActiveCalls).toEqual(["rs"]);
  });

  it("clears the active slot on delete when the active set is ours", async () => {
    const { api, setActiveCalls } = fakeApi("rs");
    await runActivation(event("Delete"), api);
    expect(setActiveCalls).toEqual([undefined]);
  });

  it("leaves another stack's active set untouched on delete", async () => {
    const { api, setActiveCalls } = fakeApi("someone-elses-rules");
    await runActivation(event("Delete"), api);
    expect(setActiveCalls).toEqual([]);
  });
});
