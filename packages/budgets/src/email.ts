import { type StringConstraint, validateString } from "@composurecdk/cloudformation";

declare const emailBrand: unique symbol;

/**
 * A validated email address suitable for use as a budget notification
 * subscriber. Construct via {@link email}; the brand prevents bare
 * strings from being passed where an `Email` is required, ensuring the
 * value has been syntactically validated and length-checked against
 * AWS Budgets' per-subscriber limit.
 */
export type Email = string & { readonly [emailBrand]: true };

/**
 * The Budgets subscriber-email constraint. Email is a *format* rule rather than
 * a character-class one, so it carries an explicit `pattern` instead of being
 * built from `stringConstraint()`'s `charClass`. The pattern errs on the side
 * of acceptance — anything obviously not an email (whitespace, missing `@`,
 * missing TLD) is rejected, but any address AWS Budgets will plausibly accept
 * passes. The 50-char cap matches the Budgets API's documented per-subscriber
 * limit. See ADR-0010.
 *
 * The domain is matched as dot-separated labels (`[^\s@.]+(\.[^\s@.]+)+`) rather
 * than `[^\s@]+\.[^\s@]+`: excluding `.` from each label removes the overlapping
 * quantifiers that make the latter a super-linear (ReDoS-prone) pattern, while
 * accepting exactly the same addresses.
 */
const EMAIL: StringConstraint = {
  name: "Budgets subscriber email",
  pattern: /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/,
  maxLength: 50,
  allowed: "an email address of the form local@domain.tld",
  source:
    "https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_Subscriber.html",
};

/** Validates a Budgets subscriber email against {@link EMAIL}. @throws on invalid input. */
export function validateEmail(value: string): void {
  validateString(value, EMAIL);
}

/**
 * Validates and brands a string as an {@link Email}. Surrounding whitespace is
 * trimmed before validation, so the branded value is exactly what AWS receives.
 *
 * @throws If the input exceeds 50 characters or is not of the form
 * `local@domain.tld`.
 */
export function email(input: string): Email {
  const trimmed = input.trim();
  validateEmail(trimmed);
  return trimmed as Email;
}
