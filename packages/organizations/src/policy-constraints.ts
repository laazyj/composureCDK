import {
  type StringConstraint,
  stringConstraint,
  validateString,
} from "@composurecdk/cloudformation";

/** The CloudFormation reference for `AWS::Organizations::Policy`, cited by every constraint here. */
export const POLICY_SOURCE =
  "https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-resource-organizations-policy.html";

const POLICY_NAME: StringConstraint = stringConstraint({
  name: "Organizations policy Name",
  charClass: "\\s\\S",
  minLength: 1,
  maxLength: 128,
  allowed: "1 to 128 characters",
  source: POLICY_SOURCE,
});

const POLICY_DESCRIPTION: StringConstraint = stringConstraint({
  name: "Organizations policy Description",
  charClass: "\\s\\S",
  maxLength: 512,
  allowed: "up to 512 characters",
  source: POLICY_SOURCE,
});

/** Validates an Organizations policy name. @throws on invalid input. */
export function validatePolicyName(value: string): void {
  validateString(value, POLICY_NAME);
}

/** Validates an Organizations policy description. @throws on invalid input. */
export function validatePolicyDescription(value: string): void {
  validateString(value, POLICY_DESCRIPTION);
}
