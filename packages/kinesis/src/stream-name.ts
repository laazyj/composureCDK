import { charSets, stringConstraint, validateString } from "@composurecdk/cloudformation";

/**
 * The name rule Kinesis applies to both streams and stream consumers: 1–128
 * characters from `[a-zA-Z0-9_.-]`.
 */
const KINESIS_NAME_RULE = {
  charClass: `${charSets.ALNUM}_.\\-`,
  minLength: 1,
  maxLength: 128,
  allowed: "ASCII letters, digits and _.-",
} as const;

/**
 * AWS-property constraint for a Kinesis data stream's name. Module-private;
 * the package exposes only {@link validateStreamName}, via the `constraints`
 * namespace in the package index. See ADR-0010.
 */
const STREAM_NAME = stringConstraint({
  name: "Kinesis Stream StreamName",
  ...KINESIS_NAME_RULE,
  source: "https://docs.aws.amazon.com/kinesis/latest/APIReference/API_CreateStream.html",
});

/**
 * AWS-property constraint for a Kinesis stream consumer's name. Module-private;
 * the package exposes only {@link validateStreamConsumerName}, via the
 * `constraints` namespace in the package index. See ADR-0010.
 */
const STREAM_CONSUMER_NAME = stringConstraint({
  name: "Kinesis StreamConsumer ConsumerName",
  ...KINESIS_NAME_RULE,
  source: "https://docs.aws.amazon.com/kinesis/latest/APIReference/API_RegisterStreamConsumer.html",
});

/**
 * Validates a Kinesis data stream name.
 *
 * @throws on invalid input.
 */
export function validateStreamName(raw: string): void {
  validateString(raw, STREAM_NAME);
}

/**
 * Validates a Kinesis stream consumer name.
 *
 * @throws on invalid input.
 */
export function validateStreamConsumerName(raw: string): void {
  validateString(raw, STREAM_CONSUMER_NAME);
}
