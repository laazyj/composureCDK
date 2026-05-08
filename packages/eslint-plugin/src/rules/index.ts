import { rule as builderMustBeTagged } from "./builder-must-be-tagged.js";
import { rule as builderMustImplementCopyState } from "./builder-must-implement-copy-state.js";
import { rule as lifecycleBuildContextRequired } from "./lifecycle-build-context-required.js";

export const rules = {
  "builder-must-be-tagged": builderMustBeTagged,
  "builder-must-implement-copy-state": builderMustImplementCopyState,
  "lifecycle-build-context-required": lifecycleBuildContextRequired,
};
