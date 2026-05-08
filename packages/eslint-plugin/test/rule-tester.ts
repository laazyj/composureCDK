import * as tsParser from "@typescript-eslint/parser";
import { RuleTester } from "eslint";
import { describe, it } from "vitest";

RuleTester.describe = describe;
RuleTester.it = it;

export const ruleTester = new RuleTester({
  languageOptions: {
    parser: tsParser,
    parserOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
    },
  },
});
