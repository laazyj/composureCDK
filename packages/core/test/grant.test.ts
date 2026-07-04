import { describe, it, expect } from "vitest";
import { grantVia, GrantQueue, type Grant } from "../src/grant.js";
import { ref, type Resolvable } from "../src/ref.js";

// A stand-in resource whose "native grant method" records who it was called
// for, so we can assert the delegation and the resolved-resource identity.
class FakeResource {
  readonly granted: string[] = [];
  grantWrite(grantee: { id: string }): void {
    this.granted.push(grantee.id);
  }
}

const grantee = { id: "role-a" };

const makeGrant = (resource: Resolvable<FakeResource>): Grant<typeof grantee> =>
  grantVia(resource, (r: FakeResource, g: typeof grantee) => {
    r.grantWrite(g);
  });

describe("grantVia", () => {
  it("resolves a concrete resource and delegates to its native grant method", () => {
    const resource = new FakeResource();

    makeGrant(resource).applyTo(grantee, {});

    expect(resource.granted).toEqual(["role-a"]);
  });

  it("resolves a Ref against the build context before delegating", () => {
    const resource = new FakeResource();
    const context = { store: { resource } };

    makeGrant(ref<{ resource: FakeResource }, FakeResource>("store", (o) => o.resource)).applyTo(
      grantee,
      context,
    );

    expect(resource.granted).toEqual(["role-a"]);
  });

  it("passes the grantee through unchanged", () => {
    const resource = new FakeResource();
    const other = { id: "role-b" };

    makeGrant(resource).applyTo(other, {});

    expect(resource.granted).toEqual(["role-b"]);
  });
});

describe("GrantQueue", () => {
  it("applies every queued grant to the grantee", () => {
    const a = new FakeResource();
    const b = new FakeResource();
    const queue = new GrantQueue<typeof grantee>();

    queue.add(makeGrant(a), makeGrant(b));
    queue.applyTo(grantee, {});

    expect(a.granted).toEqual(["role-a"]);
    expect(b.granted).toEqual(["role-a"]);
  });

  it("applies nothing when empty", () => {
    expect(() => {
      new GrantQueue<typeof grantee>().applyTo(grantee, {});
    }).not.toThrow();
  });

  it("copyInto copies queued grants onto the target", () => {
    const resource = new FakeResource();
    const source = new GrantQueue<typeof grantee>();
    source.add(makeGrant(resource));

    const target = new GrantQueue<typeof grantee>();
    source.copyInto(target);
    target.applyTo(grantee, {});

    expect(resource.granted).toEqual(["role-a"]);
  });

  it("copyInto leaves the source and target independent after the copy", () => {
    const shared = new FakeResource();
    const sourceOnly = new FakeResource();
    const targetOnly = new FakeResource();
    const source = new GrantQueue<typeof grantee>();
    source.add(makeGrant(shared));

    const target = new GrantQueue<typeof grantee>();
    source.copyInto(target);
    // Mutate each after the copy — additions must not leak across.
    source.add(makeGrant(sourceOnly));
    target.add(makeGrant(targetOnly));

    target.applyTo(grantee, {});

    expect(shared.granted).toEqual(["role-a"]);
    expect(targetOnly.granted).toEqual(["role-a"]);
    expect(sourceOnly.granted).toEqual([]);
  });
});
