declare const emailBrand: unique symbol;

/**
 * A validated email address suitable for use as a budget notification
 * subscriber. Construct via {@link email}; the brand prevents bare
 * strings from being passed where an `Email` is required, ensuring the
 * value has been syntactically validated and length-checked against
 * AWS Budgets' per-subscriber limit.
 */
export type Email = string & { readonly [emailBrand]: true };

const MAX_LEN = 50;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Validates and brands a string as an {@link Email}.
 *
 * The pattern intentionally errs on the side of acceptance — anything
 * obviously not an email (whitespace, missing `@`, missing TLD) is
 * rejected, but any address AWS Budgets will plausibly accept passes.
 * The 50-char cap matches the Budgets API's documented per-subscriber
 * limit.
 *
 * @throws If the input is empty, exceeds 50 characters, or doesn't
 * contain `local@domain.tld`.
 *
 * @see https://docs.aws.amazon.com/aws-cost-management/latest/APIReference/API_budgets_Subscriber.html
 */
export function email(input: string): Email {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    throw new Error("email cannot be empty");
  }
  if (trimmed.length > MAX_LEN) {
    throw new Error(
      `email exceeds ${String(MAX_LEN)} chars (AWS Budgets per-subscriber limit): "${trimmed}"`,
    );
  }
  if (!EMAIL_REGEX.test(trimmed)) {
    throw new Error(`invalid email address: "${trimmed}"`);
  }
  return trimmed as Email;
}
