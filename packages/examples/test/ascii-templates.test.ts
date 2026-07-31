import { describe, it, expect } from "vitest";
import { App } from "aws-cdk-lib";
import { buildExampleApp } from "../src/apps.js";

/** Enough offenders to see the pattern; a UTF-8 blob would otherwise dump thousands. */
const MAX_REPORTED = 5;

/**
 * CloudFormation stores template text as ASCII, transliterating anything
 * outside that set to `?` — silently, at deploy time. The synthesised template
 * then never matches the deployed one and `cdk diff` reports a change on every
 * run, forever (issue #336). Covers the library defaults the example stacks
 * exercise, including packages whose own tests never assert on the text.
 *
 * `JSON.stringify` escapes control characters to ASCII text, so scanning its
 * output for anything outside printable ASCII is exactly the template-level
 * question. Synthesising into the package's own `cdk.out` keeps the staged
 * assets reclaimable by `npm run clean` rather than leaking to the system
 * temp directory.
 */
describe("synthesised example templates", () => {
  it("contain only ASCII", () => {
    const offenders = buildExampleApp(new App({ outdir: "cdk.out/ascii-templates" }))
      .synth()
      .stacks.flatMap(({ stackName, template }) => {
        const json = JSON.stringify(template);
        return [...json.matchAll(/[^\x20-\x7e]/gu)].map(
          ({ 0: char, index }) =>
            `${stackName}: ${char} in ...${json.slice(Math.max(0, index - 40), index + 40)}...`,
        );
      });

    expect(offenders.slice(0, MAX_REPORTED)).toEqual([]);
  });
});
