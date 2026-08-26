import { rule as builderMustBeTagged } from "./builder-must-be-tagged.js";
import { rule as builderMustImplementCopyState } from "./builder-must-implement-copy-state.js";
import { rule as constraintMetadataRequired } from "./constraint-metadata-required.js";
import { rule as lifecycleBuildContextRequired } from "./lifecycle-build-context-required.js";
import { rule as lifecycleBuildMustForwardContext } from "./lifecycle-build-must-forward-context.js";
import { rule as noCdkApiAboveFloor } from "./no-cdk-api-above-floor.js";
import { rule as noCjsIncompatibleSyntax } from "./no-cjs-incompatible-syntax.js";
import { rule as noRealmBoundInstanceof } from "./no-realm-bound-instanceof.js";
import { rule as redeclaredPropMustTrackCdkType } from "./redeclared-prop-must-track-cdk-type.js";

export const rules = {
  "builder-must-be-tagged": builderMustBeTagged,
  "builder-must-implement-copy-state": builderMustImplementCopyState,
  "constraint-metadata-required": constraintMetadataRequired,
  "lifecycle-build-context-required": lifecycleBuildContextRequired,
  "lifecycle-build-must-forward-context": lifecycleBuildMustForwardContext,
  "no-cdk-api-above-floor": noCdkApiAboveFloor,
  "no-cjs-incompatible-syntax": noCjsIncompatibleSyntax,
  "no-realm-bound-instanceof": noRealmBoundInstanceof,
  "redeclared-prop-must-track-cdk-type": redeclaredPropMustTrackCdkType,
};
