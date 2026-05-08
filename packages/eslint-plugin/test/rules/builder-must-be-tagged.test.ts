import { rule } from "../../src/rules/builder-must-be-tagged.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("builder-must-be-tagged", rule, {
  valid: [
    {
      name: "uses taggedBuilder from cloudformation",
      code: `
        import { taggedBuilder, type ITaggedBuilder } from "@composurecdk/cloudformation";
        class MyBuilder {}
        export type IMyBuilder = ITaggedBuilder<{}>;
        export const create = () => taggedBuilder(MyBuilder);
      `,
    },
    {
      name: "imports something else from core",
      code: `
        import { Lifecycle, resolve } from "@composurecdk/core";
        export class Foo {}
      `,
    },
    {
      name: "Builder name from a different package is allowed",
      code: `
        import { Builder } from "some-other-pkg";
        Builder({});
      `,
    },
  ],
  invalid: [
    {
      name: "calling Builder() from core",
      code: `
        import { Builder } from "@composurecdk/core";
        class MyBuilder {}
        export const create = () => Builder(MyBuilder);
      `,
      errors: [{ messageId: "restrictedCall" }],
    },
    {
      name: "using IBuilder<...> type from core",
      code: `
        import type { IBuilder } from "@composurecdk/core";
        export type MyBuilderShape = IBuilder<{ name?: string }, unknown>;
      `,
      errors: [{ messageId: "restrictedType" }],
    },
    {
      name: "aliased imports are still flagged",
      code: `
        import { Builder as B, type IBuilder as IB } from "@composurecdk/core";
        class MyBuilder {}
        export type Shape = IB<{}, unknown>;
        export const create = () => B(MyBuilder);
      `,
      errors: [{ messageId: "restrictedType" }, { messageId: "restrictedCall" }],
    },
  ],
});
