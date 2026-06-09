/**
 * Packages migrated to dual ESM/CJS publishing (tshy — see ADR-0007). Each
 * entry names a known runtime export that the resolution tests probe for.
 *
 * Every entry must have a matching `peerDependency` in this package's
 * `package.json` so npm links the built package into `node_modules`.
 */
export const DUAL_PACKAGES = [
  { name: "@composurecdk/core", probe: "compose" },
  { name: "@composurecdk/acm", probe: "createCertificateBuilder" },
  { name: "@composurecdk/apigateway", probe: "createRestApiBuilder" },
  { name: "@composurecdk/budgets", probe: "createBudgetBuilder" },
  { name: "@composurecdk/cloudformation", probe: "createStackBuilder" },
  { name: "@composurecdk/cloudfront", probe: "createDistributionBuilder" },
  { name: "@composurecdk/cloudwatch", probe: "createAlarms" },
  { name: "@composurecdk/dynamodb", probe: "createTableBuilder" },
  { name: "@composurecdk/ec2", probe: "createInstanceBuilder" },
  { name: "@composurecdk/events", probe: "createRuleBuilder" },
  { name: "@composurecdk/iam", probe: "createRoleBuilder" },
  { name: "@composurecdk/lambda", probe: "createFunctionBuilder" },
  { name: "@composurecdk/logs", probe: "createLogGroupBuilder" },
  { name: "@composurecdk/route53", probe: "createHostedZoneBuilder" },
  { name: "@composurecdk/s3", probe: "createBucketBuilder" },
  { name: "@composurecdk/sns", probe: "createTopicBuilder" },
  { name: "@composurecdk/sqs", probe: "createQueueBuilder" },
] as const;
