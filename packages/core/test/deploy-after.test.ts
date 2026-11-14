import { describe, it, expect } from "vitest";
import { Construct, RootConstruct, type IConstruct } from "constructs";
import { at } from "../src/build-id.js";
import { compose } from "../src/compose.js";
import { deployAfter } from "../src/deploy-after.js";
import { type Lifecycle } from "../src/lifecycle.js";
import { ref } from "../src/ref.js";

interface Result {
  main: IConstruct;
  peer: IConstruct;
}

/** A component that creates a primary construct and a peer beside it. */
function resource(): Lifecycle<Result> {
  return {
    build: (scope, id) => ({
      main: new Construct(scope, id),
      peer: new Construct(scope, `${id}-peer`),
    }),
  };
}

const mainOf = (r: Result) => r.main;

const ordered = (inner: Lifecycle<Result> = resource()) =>
  deployAfter(inner, { target: mainOf, after: [ref("delegation", mainOf)] });

function build(certificate: Lifecycle<Result>, deps: "delegation"[] = ["delegation"]) {
  return compose(
    { delegation: resource(), certificate },
    { delegation: [], certificate: deps },
  ).build(new RootConstruct(), "App");
}

describe("deployAfter", () => {
  it("orders the target after the selected construct of a sibling", () => {
    const result = build(ordered());

    expect(result.certificate.main.node.dependencies).toEqual([result.delegation.main]);
    expect(result.certificate.peer.node.dependencies).toEqual([]);
  });

  it("orders the target after every construct of a whole-component ref", () => {
    const result = build(
      deployAfter(resource(), { target: mainOf, after: [ref<Result>("delegation")] }),
    );

    expect(result.certificate.main.node.dependencies).toEqual([
      result.delegation.main,
      result.delegation.peer,
    ]);
  });

  it("returns the inner component's result unchanged", () => {
    const root = new RootConstruct();
    const source = new Construct(root, "Source");

    const result = deployAfter(resource(), { target: mainOf, after: [source] }).build(root, "Cert");

    expect(result.main.node.path).toBe("Cert");
    expect(result.main.node.dependencies).toEqual([source]);
  });

  it("wraps a composed system, targeting one of its components", () => {
    const system = compose({ api: resource(), domain: resource() }, { api: [], domain: [] });

    const result = compose(
      {
        delegation: resource(),
        site: deployAfter(system, {
          target: (r) => r.domain.main,
          after: [ref("delegation", mainOf)],
        }),
      },
      { delegation: [], site: ["delegation"] },
    ).build(new RootConstruct(), "App");

    expect(result.site.domain.main.node.dependencies).toEqual([result.delegation.main]);
    expect(result.site.api.main.node.dependencies).toEqual([]);
  });

  it.each([
    ["deployAfter(at(...))", () => ordered(at("Cert", resource()))],
    ["at(deployAfter(...))", () => at("Cert", ordered())],
  ])("keeps the at() pin for %s", (_, component) => {
    const result = build(component());

    expect(result.certificate.main.node.path).toBe("Cert");
    expect(result.certificate.main.node.dependencies).toEqual([result.delegation.main]);
  });

  it("resolves a source through the parent system's context (ADR-0003)", () => {
    const result = compose(
      {
        delegation: resource(),
        site: compose({ certificate: ordered() }, { certificate: [] }),
      },
      { delegation: [], site: ["delegation"] },
    ).build(new RootConstruct(), "App");

    expect(result.site.certificate.main.node.dependencies).toEqual([result.delegation.main]);
  });

  it("fails with the ref's own error when the sibling is not a declared dependency", () => {
    expect(() => build(ordered(), [])).toThrow(/Ref to "delegation" cannot be resolved/);
  });
});
