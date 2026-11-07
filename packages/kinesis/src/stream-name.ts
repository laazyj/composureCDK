import { charSets, stringConstraint, validateString } from "@composurecdk/cloudformation";

/**
 * AWS-property constraint for a Kinesis data stream's name. Module-private;
 * the package exposes only {@link validateStreamName}, via the `constraints`
 * namespace in the package index. See ADR-0010.
 */
const STREAM_NAME = stringConstraint({
  name: "Kinesis Stream StreamName",
  charClass: `${charSets.ALNUM}_.\\-`,
  minLength: 1,
  maxLength: 128,
  allowed: "ASCII letters, digits and _.-",
  source: "https://docs.aws.amazon.com/kinesis/latest/APIReference/API_CreateStream.html",
});

/**
 * Validates a Kinesis data stream name.
 *
 * @throws on invalid input.
 */
export function validateStreamName(raw: string): void {
  validateString(raw, STREAM_NAME);
}
