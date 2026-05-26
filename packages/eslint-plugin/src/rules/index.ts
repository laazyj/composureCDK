import { rule as builderMustBeTagged } from "./builder-must-be-tagged.js";
import { rule as builderMustImplementCopyState } from "./builder-must-implement-copy-state.js";
import { rule as lifecycleBuildContextRequired } from "./lifecycle-build-context-required.js";
import { rule as noCdkApiAboveFloor } from "./no-cdk-api-above-floor.js";
import { rule as noCjsIncompatibleSyntax } from "./no-cjs-incompatible-syntax.js";

export const rules = {
  "builder-must-be-tagged": builderMustBeTagged,
  "builder-must-implement-copy-state": builderMustImplementCopyState,
  "lifecycle-build-context-required": lifecycleBuildContextRequired,
  "no-cdk-api-above-floor": noCdkApiAboveFloor,
  "no-cjs-incompatible-syntax": noCjsIncompatibleSyntax,
};
