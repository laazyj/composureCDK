import { describe, it, expect } from "vitest";
import { Construct, RootConstruct, type IConstruct } from "constructs";
import { at } from "../src/build-id.js";
import { compose } from "../src/compose.js";
import { deployAfter } from "../src/deploy-after.js";
import { type Lifecycle } from "../src/lifecycle.js";
import { ref } from "../src/ref.js";

interface Result {
  main: IConstruct;
  passedIn?: IConstruct;
}

/** A component that creates a primary construct and passes another through. */
function resource(passedIn?: IConstruct): Lifecycle<Result> {
  return {
    build: (scope, id) => ({ main: new Construct(scope, id), passedIn }),
  };
}

const mainOf = (r: Result) => r.main;

const ordered = (inner: Lifecycle<Result> = resource()) =>
  deployAfter([ref("delegation", mainOf)], inner, mainOf);

function build(certificate: Lifecycle<Result>, deps: "delegation"[] = ["delegation"]) {
  return compose(
    { delegation: resource(), certificate },
    { delegation: [], certificate: deps },
  ).build(new RootConstruct(), "App");
}

describe("deployAfter", () => {
  it("orders the target, and only the target, after the sibling", () => {
    const shared = new Construct(new RootConstruct(), "Shared");

    const result = build(ordered(resource(shared)));

    expect(result.certificate.main.node.dependencies).toEqual([result.delegation.main]);
    expect(shared.node.dependencies).toEqual([]);
  });

  it("returns the inner component's result unchanged", () => {
    const root = new RootConstruct();
    const source = new Construct(root, "Source");

    const result = deployAfter([source], resource(), mainOf).build(root, "Cert");

    expect(result.main.node.path).toBe("Cert");
    expect(result.main.node.dependencies).toEqual([source]);
  });

  it.each([
    ["deployAfter(at(...))", () => ordered(at("Cert", resource()))],
    ["at(deployAfter(...))", () => at("Cert", ordered())],
  ])("keeps the at() pin for %s", (_, component) => {
    const result = build(component());

    expect(result.certificate.main.node.path).toBe("Cert");
    expect(result.certificate.main.node.dependencies).toEqual([result.delegation.main]);
  });

  it("fails with the ref's own error when the sibling is not a declared dependency", () => {
    expect(() => build(ordered(), [])).toThrow(/Ref to "delegation" cannot be resolved/);
  });
});
