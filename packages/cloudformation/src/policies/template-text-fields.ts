/**
 * Free-text properties keyed by CloudFormation resource type, with **CDK L1
 * property names** (camelCase) as values — the policy reads and writes them
 * through the L1 accessor, so `alarmDescription`, not `AlarmDescription`.
 *
 * This is also the shape of {@link TemplateTextPolicyConfig.fields}, which is
 * merged over the built-in registry.
 */
export type TemplateTextFields = Readonly<Record<string, readonly string[]>>;

/**
 * The fields {@link templateTextPolicy} checks by default.
 *
 * Keying by resource-type string is what keeps this registry in
 * `@composurecdk/cloudformation` without inverting the dependency graph: it
 * names `AWS::Lambda::Function` without importing `@composurecdk/lambda`, so a
 * consumer of one service does not transitively pull in every other
 * (ADR-0010, ADR-0017 §4).
 *
 * Only top-level scalar properties are listed. Nested paths
 * (`DistributionConfig.Comment`, `HostedZoneConfig.Comment`) need a resolve on
 * the way in and an `addPropertyOverride` on the way out; they are a separate
 * change. A field earns a place here if a consumer can put arbitrary prose in
 * it.
 */
export const TEMPLATE_TEXT_FIELDS: TemplateTextFields = {
  "AWS::ApiGateway::ApiKey": ["description"],
  "AWS::ApiGateway::Deployment": ["description"],
  "AWS::ApiGateway::RestApi": ["description"],
  "AWS::ApiGateway::Stage": ["description"],
  "AWS::ApiGateway::UsagePlan": ["description"],
  "AWS::CloudWatch::Alarm": ["alarmDescription"],
  "AWS::CloudWatch::CompositeAlarm": ["alarmDescription"],
  "AWS::EC2::SecurityGroup": ["groupDescription"],
  "AWS::Events::Rule": ["description"],
  "AWS::IAM::ManagedPolicy": ["description"],
  "AWS::IAM::Role": ["description"],
  "AWS::Lambda::Function": ["description"],
  "AWS::Neptune::DBClusterParameterGroup": ["description"],
  "AWS::Neptune::DBParameterGroup": ["description"],
  "AWS::SNS::Topic": ["displayName"],
};
