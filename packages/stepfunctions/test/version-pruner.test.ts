import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  runVersionPruning,
  type VersionPruningApi,
  type VersionPruningEvent,
  versionsToPrune,
} from "../src/version-pruner-handler.js";

const SM = "arn:aws:states:eu-west-2:111122223333:stateMachine:orders";
const v = (n: number) => `${SM}:${String(n)}`;

function fakeApi(versions: string[], aliased: string[] = []) {
  const deleted: string[] = [];
  const api: VersionPruningApi = {
    listVersionArns: () => Promise.resolve(versions),
    listAliasedVersionArns: () => Promise.resolve(aliased),
    deleteVersion: (arn) => {
      deleted.push(arn);
      return Promise.resolve();
    },
  };
  return { api, deleted };
}

const event = (
  RequestType: VersionPruningEvent["RequestType"],
  retain = 2,
): VersionPruningEvent => ({
  RequestType,
  ResourceProperties: { StateMachineArn: SM, Retain: String(retain) },
});

describe("versionsToPrune", () => {
  it("keeps the newest by version number, whatever order they are listed in", () => {
    expect(versionsToPrune([v(2), v(10), v(9), v(1)], 2, [])).toEqual([v(2), v(1)]);
  });

  it("keeps a version an alias routes to, however old", () => {
    expect(versionsToPrune([v(1), v(2), v(3), v(4)], 2, [v(1)])).toEqual([v(2)]);
  });

  it("deletes nothing when no more than the limit exist", () => {
    expect(versionsToPrune([v(1), v(2)], 5, [])).toEqual([]);
  });
});

describe("runVersionPruning", () => {
  it.each(["Create", "Update"] as const)(
    "deletes versions beyond the limit on %s",
    async (type) => {
      const { api, deleted } = fakeApi([v(1), v(2), v(3), v(4)], [v(1)]);

      const result = await runVersionPruning(event(type, 2), api);

      expect(deleted).toEqual(versionsToPrune([v(1), v(2), v(3), v(4)], 2, [v(1)]));
      expect(result.Data.Deleted).toBe(deleted.length);
    },
  );

  it("skips the alias lookups while under the limit", async () => {
    const { api, deleted } = fakeApi([v(1), v(2)]);
    let aliasLookups = 0;
    api.listAliasedVersionArns = () => {
      aliasLookups++;
      return Promise.resolve([]);
    };

    await runVersionPruning(event("Update", 2), api);

    expect(aliasLookups).toBe(0);
    expect(deleted).toEqual([]);
  });

  it("does nothing on Delete, since deleting the state machine deletes its versions", async () => {
    const { api, deleted } = fakeApi([v(1), v(2), v(3)]);

    await runVersionPruning(event("Delete", 1), api);

    expect(deleted).toEqual([]);
  });

  it("keeps the same physical id across events", async () => {
    const { api } = fakeApi([]);

    const ids = await Promise.all(
      (["Create", "Update", "Delete"] as const).map(
        async (type) => (await runVersionPruning(event(type), api)).PhysicalResourceId,
      ),
    );

    expect(new Set(ids).size).toBe(1);
  });

  it("runs once serialised, as the provider Lambda runs it", async () => {
    const serialised = runInNewContext(
      `${versionsToPrune.toString()}\n${runVersionPruning.toString()}\nrunVersionPruning`,
    ) as typeof runVersionPruning;
    const { api, deleted } = fakeApi([v(1), v(2), v(3)]);

    await serialised(event("Update", 1), api);

    expect(deleted).toEqual([v(2), v(1)]);
  });
});
