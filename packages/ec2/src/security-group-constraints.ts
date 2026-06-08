import { Token } from "aws-cdk-lib";
import { charSets, stringConstraint, validateString } from "@composurecdk/cloudformation";

/**
 * AWS-property constraints for EC2 security groups.
 *
 * The catalogue mechanism (`stringConstraint` / `validateString`) lives in
 * `@composurecdk/cloudformation`; this per-resource data lives next to the
 * builder that enforces it. The trigger for the catalogue was an em-dash in a
 * `GroupDescription` reaching CloudFormation and failing at CREATE_FAILED — a
 * `validate*` call in `build()` turns that into a `cdk synth` error. See
 * ADR-0010.
 *
 * The constraints themselves are module-private; the package exposes only the
 * `validate*` functions (via the `constraints` namespace in the package index).
 *
 * `GroupDescription` and `GroupName` share the same EC2 character set, so they
 * spread the same class fragments; the comma/bracket tail beyond the shared
 * `charSets.AWS_NAME_PUNCT` spine is EC2-specific and stays local.
 */
const SG_TAIL = ",\\[\\]&;{}!$*";
const SG_CHAR_CLASS = `${charSets.ALNUM}${charSets.AWS_NAME_PUNCT}${SG_TAIL}`;
const SG_ALLOWED = "ASCII letters, digits, spaces and ._-:/()#,@[]+=&;{}!$*";
const SG_SOURCE =
  "https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_CreateSecurityGroup.html";

const SECURITY_GROUP_DESCRIPTION = stringConstraint({
  name: "EC2 SecurityGroup GroupDescription",
  charClass: SG_CHAR_CLASS,
  maxLength: 255,
  allowed: SG_ALLOWED,
  source: SG_SOURCE,
});

const SECURITY_GROUP_NAME = stringConstraint({
  name: "EC2 SecurityGroup GroupName",
  charClass: SG_CHAR_CLASS,
  minLength: 1,
  maxLength: 255,
  allowed: SG_ALLOWED,
  source: SG_SOURCE,
});

/**
 * Validates an EC2 security group description. Unresolved CDK tokens are
 * skipped — their value is resolved by CloudFormation and is not knowable at
 * synth (ADR-0010).
 *
 * @throws on invalid input.
 */
export function validateSecurityGroupDescription(raw: string): void {
  if (Token.isUnresolved(raw)) return;
  validateString(raw, SECURITY_GROUP_DESCRIPTION);
}

/**
 * Validates an EC2 security group name. AWS additionally reserves the `sg-`
 * prefix for generated group IDs, so a user-supplied name must not use it.
 * Unresolved CDK tokens are skipped (ADR-0010).
 *
 * @throws on invalid input.
 */
export function validateSecurityGroupName(raw: string): void {
  if (Token.isUnresolved(raw)) return;
  if (raw.startsWith("sg-")) {
    throw new Error(
      `EC2 SecurityGroup GroupName "${raw}" must not start with the reserved "sg-" prefix. See ${SG_SOURCE}.`,
    );
  }
  validateString(raw, SECURITY_GROUP_NAME);
}
