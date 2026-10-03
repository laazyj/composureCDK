import { describe, expect, it } from "vitest";
import { constraints } from "../src/index.js";
import { sanitizeTemplateText, validateTemplateText } from "../src/constraints/template-text.js";

describe("constraints", () => {
  it("exposes the template-text rule under validate and sanitize", () => {
    expect(constraints.validate.templateText).toBe(validateTemplateText);
    expect(constraints.sanitize.templateText).toBe(sanitizeTemplateText);
  });
});
