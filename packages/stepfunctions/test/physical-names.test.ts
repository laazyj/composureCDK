import { describe, expect, it } from "vitest";
import { newStack } from "@composurecdk/cdk-testing";
import { lazyUniqueName } from "../src/physical-names.js";

describe("lazyUniqueName", () => {
  it("throws if resolved before its construct is built", () => {
    const stack = newStack();

    expect(() => {
      stack.resolve(lazyUniqueName(() => undefined, 80));
    }).toThrow(/before the construct/);
  });

  it("caps the name, prefix included, at maxLength", () => {
    const stack = newStack(undefined, "A".repeat(100));

    const name = stack.resolve(lazyUniqueName(() => stack, 80, "/prefix/")) as string;
    expect(name).toHaveLength(80);
    expect(name.startsWith("/prefix/")).toBe(true);
  });
});
