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
  private readonly _key: string;
  private _metricFactory?: (construct: TConstruct) => Metric;
  private _threshold = 0;
  private _comparisonOperator = ComparisonOperator.GREATER_THAN_THRESHOLD;
  private _evaluationPeriods = 1;
  private _datapointsToAlarm = 1;
  private _treatMissingData = TreatMissingData.NOT_BREACHING;
  private _description: string | ((definition: AlarmDefinition) => string) = "";

  constructor(key: string) {
    this._key = key;
  }

  metric(factory: (construct: TConstruct) => Metric): this {
    this._metricFactory = factory;
    return this;
  }

  threshold(value: number): this {
    this._threshold = value;
    return this;
  }

  greaterThan(): this {
    this._comparisonOperator = ComparisonOperator.GREATER_THAN_THRESHOLD;
    return this;
  }

  greaterThanOrEqual(): this {
    this._comparisonOperator = ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD;
    return this;
  }

  lessThan(): this {
    this._comparisonOperator = ComparisonOperator.LESS_THAN_THRESHOLD;
    return this;
  }

  lessThanOrEqual(): this {
    this._comparisonOperator = ComparisonOperator.LESS_THAN_OR_EQUAL_TO_THRESHOLD;
    return this;
  }

  evaluationPeriods(n: number): this {
    this._evaluationPeriods = n;
    return this;
  }

  datapointsToAlarm(n: number): this {
    this._datapointsToAlarm = n;
    return this;
  }

  treatMissingData(treatment: TreatMissingData): this {
    this._treatMissingData = treatment;
    return this;
  }

  description(text: string | ((definition: AlarmDefinition) => string)): this {
    this._description = text;
    return this;
  }

  /**
   * Resolves the deferred metric factory against a construct and
   * returns a complete {@link AlarmDefinition}.
   *
   * @throws If {@link metric} was not called before resolve.
   */
  resolve(construct: TConstruct): AlarmDefinition {
    if (!this._metricFactory) {
      throw new Error(
        `AlarmDefinitionBuilder "${this._key}": metric() must be called before resolve()`,
      );
    }

    const definition: AlarmDefinition = {
      key: this._key,
      metric: this._metricFactory(construct),
      threshold: this._threshold,
      comparisonOperator: this._comparisonOperator,
      evaluationPeriods: this._evaluationPeriods,
      datapointsToAlarm: this._datapointsToAlarm,
      treatMissingData: this._treatMissingData,
      description: "",
    };

    definition.description =
      typeof this._description === "function" ? this._description(definition) : this._description;

    return definition;
  }
}
