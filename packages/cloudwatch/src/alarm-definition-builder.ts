import { ComparisonOperator, type Metric, TreatMissingData } from "aws-cdk-lib/aws-cloudwatch";
import type { AlarmDefinition } from "./alarm-definition.js";

/**
 * Fluent builder for constructing deferred {@link AlarmDefinition}s.
 *
 * Stores a metric factory `(construct: T) => Metric` at configuration time.
 * Call {@link resolve} during build to invoke the factory and produce a
 * complete {@link AlarmDefinition}.
 *
 * @typeParam TConstruct - The construct type the metric factory receives.
 */
export class AlarmDefinitionBuilder<TConstruct> {
  readonly #key: string;
  #metricFactory?: (construct: TConstruct) => Metric;
  #threshold = 0;
  #comparisonOperator = ComparisonOperator.GREATER_THAN_THRESHOLD;
  #evaluationPeriods = 1;
  #datapointsToAlarm = 1;
  #treatMissingData = TreatMissingData.NOT_BREACHING;
  #description: string | ((definition: AlarmDefinition) => string) = "";

  constructor(key: string) {
    this.#key = key;
  }

  metric(factory: (construct: TConstruct) => Metric): this {
    this.#metricFactory = factory;
    return this;
  }

  threshold(value: number): this {
    this.#threshold = value;
    return this;
  }

  greaterThan(): this {
    this.#comparisonOperator = ComparisonOperator.GREATER_THAN_THRESHOLD;
    return this;
  }

  greaterThanOrEqual(): this {
    this.#comparisonOperator = ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    return this;
  }

  lessThan(): this {
    this.#comparisonOperator = ComparisonOperator.LESS_THAN_THRESHOLD;
    return this;
  }

  lessThanOrEqual(): this {
    this.#comparisonOperator = ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD;
    return this;
  }

  evaluationPeriods(n: number): this {
    this.#evaluationPeriods = n;
    return this;
  }

  datapointsToAlarm(n: number): this {
    this.#datapointsToAlarm = n;
    return this;
  }

  treatMissingData(treatment: TreatMissingData): this {
    this.#treatMissingData = treatment;
    return this;
  }

  description(text: string | ((definition: AlarmDefinition) => string)): this {
    this.#description = text;
    return this;
  }

  /**
   * Resolves the deferred metric factory against a construct and
   * returns a complete {@link AlarmDefinition}.
   *
   * @throws If {@link metric} was not called before resolve.
   */
  resolve(construct: TConstruct): AlarmDefinition {
    if (!this.#metricFactory) {
      throw new Error(
        `AlarmDefinitionBuilder "${this.#key}": metric() must be called before resolve()`,
      );
    }

    const definition: AlarmDefinition = {
      key: this.#key,
      metric: this.#metricFactory(construct),
      threshold: this.#threshold,
      comparisonOperator: this.#comparisonOperator,
      evaluationPeriods: this.#evaluationPeriods,
      datapointsToAlarm: this.#datapointsToAlarm,
      treatMissingData: this.#treatMissingData,
      description: "",
    };

    definition.description =
      typeof this.#description === "function" ? this.#description(definition) : this.#description;

    return definition;
  }
}
