## 0.9.1 (2026-07-11)

### 🚀 Features

- **custom-resources:** add AwsCustomResource builder ([#294](https://github.com/laazyj/composureCDK/pull/294), [#280](https://github.com/laazyj/composureCDK/issues/280))

### 💀 Thank You

- Jason Duffett

## 0.9.0 (2026-07-09)

### 🚀 Features

- **core:** add consumer-side grant primitives ([#269](https://github.com/laazyj/composureCDK/issues/269))
- **core:** add combine() multi-ref combinator ([#270](https://github.com/laazyj/composureCDK/issues/270), [#276](https://github.com/laazyj/composureCDK/issues/276))
- **dynamodb:** add tableGrants capability helpers ([#269](https://github.com/laazyj/composureCDK/issues/269))
- **iam:** add consumer-side role.grant() ([#269](https://github.com/laazyj/composureCDK/issues/269))
- **iam:** accept a Resolvable principal in RoleBuilder.assumedBy ([e619485](https://github.com/laazyj/composureCDK/commit/e619485))
- **iam:** add general-purpose OIDC provider builder and principal helper ([#278](https://github.com/laazyj/composureCDK/issues/278))
- **iam:** add GitHub Actions OIDC convenience layer ([#278](https://github.com/laazyj/composureCDK/issues/278))
- **lambda:** add consumer-side function.grant() ([#269](https://github.com/laazyj/composureCDK/issues/269))
- **lambda:** add functionGrants invoke helpers ([#269](https://github.com/laazyj/composureCDK/issues/269))
- **route53:** support absolute and token record names in the zone DSL ([#281](https://github.com/laazyj/composureCDK/issues/281), [#279](https://github.com/laazyj/composureCDK/issues/279))
- **s3:** add bucketGrants capability helpers ([#269](https://github.com/laazyj/composureCDK/issues/269))
- **sns:** add topicGrants capability helpers ([#269](https://github.com/laazyj/composureCDK/issues/269))
- **sqs:** add queueGrants capability helpers ([#269](https://github.com/laazyj/composureCDK/issues/269))
- **sqs:** add queue roles for FIFO and dead-letter queues ([#255](https://github.com/laazyj/composureCDK/pull/255))

### 🩹 Fixes

- ⚠️ **core:** reject leaked tokens in construct IDs ([#283](https://github.com/laazyj/composureCDK/pull/283))

### ⚠️ Breaking Changes

- **core:** reject leaked tokens in construct IDs ([#283](https://github.com/laazyj/composureCDK/pull/283))
  sanitizeConstructId and constructId now throw on inputs
  containing { } [ ] instead of passing them through. Callers that relied
  on those characters surviving into a construct ID must supply a stable,
  static ID instead."
  M packages/core/src/construct-id.ts
  M packages/core/test/construct-id.test.ts

### ❤️ Thank You

- Jason Duffett

## 0.8.7 (2026-06-29)

### 🚀 Features

- **core:** add at() to pin a component's construct id ([#248](https://github.com/laazyj/composureCDK/pull/248), [#245](https://github.com/laazyj/composureCDK/issues/245))

### ❤️ Thank You

- Jason Duffett

## 0.8.6 (2026-06-28)

### 🚀 Features

- **lambda:** add dynamoEventSource() and stream IteratorAge alarm ([#231](https://github.com/laazyj/composureCDK/pull/231))
- **lambda:** guard SQS visibility-timeout against function timeout ([#122](https://github.com/laazyj/composureCDK/issues/122), [#198](https://github.com/laazyj/composureCDK/issues/198), [#195](https://github.com/laazyj/composureCDK/issues/195), [#123](https://github.com/laazyj/composureCDK/issues/123))
- **route53:** make NsRecordBuilder values Resolvable ([#243](https://github.com/laazyj/composureCDK/pull/243))

### ❤️ Thank You

- Jason Duffett

## 0.8.5 (2026-06-20)

### 🚀 Features

- **cloudwatch:** add alarm threshold token guard ([#196](https://github.com/laazyj/composureCDK/issues/196))
- **dynamodb:** add @composurecdk/dynamodb with Table and TableV2 builders ([#221](https://github.com/laazyj/composureCDK/pull/221), [#121](https://github.com/laazyj/composureCDK/issues/121))
- **ec2:** VPC interface-endpoint builder ([#194](https://github.com/laazyj/composureCDK/pull/194), [#201](https://github.com/laazyj/composureCDK/pull/201))

### 🩹 Fixes

- remove duplicate security entry from issue config ([#218](https://github.com/laazyj/composureCDK/pull/218))
- **ci:** grant deploy-test role Neptune smoke-test permissions ([#202](https://github.com/laazyj/composureCDK/pull/202))
- **deps:** raise aws-cdk-lib floor to 2.93.0 for addWarningV2 ([0942766](https://github.com/laazyj/composureCDK/commit/0942766))
- **dynamodb:** stabilise alarms test lint across Node matrix ([8e991d4](https://github.com/laazyj/composureCDK/commit/8e991d4))
- **lambda:** guard token-valued alarm thresholds ([#196](https://github.com/laazyj/composureCDK/issues/196))

### ❤️ Thank You

- Claude
- Jason Duffett

## 0.8.4 (2026-06-10)

### 🚀 Features

- **constraints:** AWS-property constraint catalogue ([#188](https://github.com/laazyj/composureCDK/pull/188), [#166](https://github.com/laazyj/composureCDK/issues/166))
- **neptune:** add Amazon Neptune cluster builder ([#189](https://github.com/laazyj/composureCDK/pull/189), [#141](https://github.com/laazyj/composureCDK/issues/141))

### 🩹 Fixes

- **ec2:** let user-pinned availabilityZones override default maxAzs ([#187](https://github.com/laazyj/composureCDK/pull/187), [#153](https://github.com/laazyj/composureCDK/issues/153))

### ❤️ Thank You

- Jason Duffett

## 0.8.3 (2026-06-01)

### 🚀 Features

- aws-cdk-lib floor diagnostics (ADR-0008) ([#161](https://github.com/laazyj/composureCDK/pull/161))
- **ci:** per-package floor enforcement via the unit suites (ADR-0008) ([#170](https://github.com/laazyj/composureCDK/pull/170), [#146](https://github.com/laazyj/composureCDK/issues/146))
- **cloudwatch:** per-alarm constructId override ([#185](https://github.com/laazyj/composureCDK/pull/185), [#149](https://github.com/laazyj/composureCDK/issues/149))
- **examples:** exercise SG builder in Ec2Stack (avoid duplicate deploy) ([#164](https://github.com/laazyj/composureCDK/issues/164))

### 🩹 Fixes

- **budgets:** raise aws-cdk-lib floor to 2.93.0 ([#179](https://github.com/laazyj/composureCDK/pull/179))
- **cloudformation:** raise aws-cdk-lib floor to 2.1.0 ([4a5290c](https://github.com/laazyj/composureCDK/commit/4a5290c))
- **cloudfront:** bump aws-cdk-lib floor to 2.124.0 ([5d0fe84](https://github.com/laazyj/composureCDK/commit/5d0fe84))
- **ec2:** raise aws-cdk-lib floor to 2.140.0 ([13e2f95](https://github.com/laazyj/composureCDK/commit/13e2f95))
- **events:** raise aws-cdk-lib floor to 2.85.0 ([#181](https://github.com/laazyj/composureCDK/pull/181))
- **iam:** raise aws-cdk-lib floor to 2.26.0 ([#180](https://github.com/laazyj/composureCDK/pull/180))
- **s3:** raise aws-cdk-lib floor to 2.123.0 ([4620ec3](https://github.com/laazyj/composureCDK/commit/4620ec3))
- **sns:** raise aws-cdk-lib floor to 2.178.0 ([541dc10](https://github.com/laazyj/composureCDK/commit/541dc10))
- **sqs:** raise aws-cdk-lib floor to 2.93.0 ([#178](https://github.com/laazyj/composureCDK/pull/178))

### ❤️ Thank You

- Jason Duffett

## 0.8.2 (2026-05-28)

### 🚀 Features

- per-package aws-cdk-lib peer floors (ADR-0008) ([#146](https://github.com/laazyj/composureCDK/issues/146))
- **ec2:** SecurityGroup builder with closed-egress default ([#152](https://github.com/laazyj/composureCDK/issues/152))

### ❤️ Thank You

- Jason Duffett

## 0.8.1 (2026-05-26)

### 🚀 Features

- **cloudwatch:** accept MathExpression in AlarmDefinition metric ([#144](https://github.com/laazyj/composureCDK/issues/144))
- **eslint-plugin:** ban CDK APIs above the floor ([#151](https://github.com/laazyj/composureCDK/pull/151), [#146](https://github.com/laazyj/composureCDK/issues/146))
- **sqs:** warn when redrive maxReceiveCount is below 5 ([#124](https://github.com/laazyj/composureCDK/issues/124))

### 🩹 Fixes

- **cloudwatch:** support older aws-cdk-lib ([#146](https://github.com/laazyj/composureCDK/issues/146))
- **release:** hoist nx release git config to release.git ([91dc0ae](https://github.com/laazyj/composureCDK/commit/91dc0ae))
- **release:** break nx git-config deadlock between CI and local preview ([#71](https://github.com/laazyj/composureCDK/issues/71))

### ❤️ Thank You

- Jason Duffett

## 0.8.0 (2026-05-16)

### 🚀 Features

- dual ESM/CJS publishing as an enforced project-wide standard ([#126](https://github.com/laazyj/composureCDK/pull/126), [#119](https://github.com/laazyj/composureCDK/issues/119))
- **eslint-plugin:** ban CJS-incompatible syntax in library src ([#119](https://github.com/laazyj/composureCDK/issues/119))
- ⚠️ **lambda:** scope execution-role logs permissions to the function's own log group ([#105](https://github.com/laazyj/composureCDK/pull/105), [#41](https://github.com/laazyj/composureCDK/issues/41))
- **lambda:** SQS event source wiring with contextual alarms ([#125](https://github.com/laazyj/composureCDK/pull/125), [#118](https://github.com/laazyj/composureCDK/issues/118))
- **route53:** default-on DNS query logging with shared resource policy ([#101](https://github.com/laazyj/composureCDK/pull/101), [#44](https://github.com/laazyj/composureCDK/issues/44))
- **sns:** protocol-specific subscription defaults ([#116](https://github.com/laazyj/composureCDK/pull/116), [#35](https://github.com/laazyj/composureCDK/issues/35))
- **sqs:** add @composurecdk/sqs with QueueBuilder ([#115](https://github.com/laazyj/composureCDK/pull/115), [#112](https://github.com/laazyj/composureCDK/issues/112))

### 🩹 Fixes

- **ci:** trigger release.yml via tag push instead of workflow_call ([7a6eeb4](https://github.com/laazyj/composureCDK/commit/7a6eeb4))
- ⚠️ **sns:** route SubscriptionBuilder through ITopicSubscription.bind() ([#39](https://github.com/laazyj/composureCDK/issues/39), [#38](https://github.com/laazyj/composureCDK/issues/38))

### ⚠️ Breaking Changes

- **sns:** route SubscriptionBuilder through ITopicSubscription.bind() ([#39](https://github.com/laazyj/composureCDK/issues/39), [#38](https://github.com/laazyj/composureCDK/issues/38))
- **lambda:** scope execution-role logs permissions to the function's own log group ([#105](https://github.com/laazyj/composureCDK/pull/105), [#41](https://github.com/laazyj/composureCDK/issues/41))
  the IAM role's CloudFormation logical id changes from
  "<id>ServiceRole<hash>" (nested under the function) to
  "<id>ExecutionRole<hash>" (sibling). Existing stacks will replace the
  role on upgrade. Use .useCdkAutoRole() to opt back into CDK's prior
  behaviour during a phased migration.
  BREAKING CHANGE: FunctionBuilderProps.role is widened from IRole to
  Resolvable<IRole>; the .role() setter is mutually exclusive with
  .configureRole() and .useCdkAutoRole().
  Closes #41

### ❤️ Thank You

- Claude (laazyj)
- Claude Opus 4.7 (1M context)
- Jason Duffett

## 0.7.0 (2026-05-08)

### 🚀 Features

- ⚠️ roll taggedBuilder out across remaining builders + lint enforcement ([1e6a517](https://github.com/laazyj/composureCDK/commit/1e6a517))
- **acm:** add [COPY_STATE] hook to CertificateBuilder ([#88](https://github.com/laazyj/composureCDK/pull/88), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **apigateway:** add [COPY_STATE] to RestApi/SpecRestApiBuilder ([#89](https://github.com/laazyj/composureCDK/pull/89), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **budgets:** add [COPY_STATE] to Budget/BudgetAlarmBuilder ([#90](https://github.com/laazyj/composureCDK/pull/90), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **cloudformation:** add taggedBuilder wrapper, tag validator, and result-walker ([#66](https://github.com/laazyj/composureCDK/issues/66))
- ⚠️ **cloudformation:** route StackBuilder through taggedBuilder, drop bespoke #tags ([5246f65](https://github.com/laazyj/composureCDK/commit/5246f65))
- **cloudformation:** add tags() afterBuild helper, ADR-0006, docs, example ([76b302b](https://github.com/laazyj/composureCDK/commit/76b302b))
- **cloudfront:** add [COPY_STATE] to Distribution/CloudFrontAlarmBuilder ([#91](https://github.com/laazyj/composureCDK/pull/91), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **core:** add assertCopyPreservesState test helper at /testing subpath ([55911a0](https://github.com/laazyj/composureCDK/commit/55911a0))
- **ec2:** createVolumeBuilder with well-architected defaults ([#76](https://github.com/laazyj/composureCDK/issues/76))
- **ec2:** InstanceBuilder.attachVolume with synth-time AZ validation ([#76](https://github.com/laazyj/composureCDK/issues/76))
- **ec2:** add [COPY_STATE] to Instance/VolumeBuilder ([#92](https://github.com/laazyj/composureCDK/pull/92), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **eslint:** add builder-must-implement-copy-state rule ([#98](https://github.com/laazyj/composureCDK/pull/98), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **events:** add @composurecdk/events with RuleBuilder, target helpers, alarms ([#85](https://github.com/laazyj/composureCDK/pull/85), [#67](https://github.com/laazyj/composureCDK/issues/67))
- **iam:** add [COPY_STATE] to Role/ManagedPolicyBuilder ([#93](https://github.com/laazyj/composureCDK/pull/93), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **lambda:** add [COPY_STATE] to FunctionBuilder ([#94](https://github.com/laazyj/composureCDK/pull/94), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **route53:** add [COPY_STATE] to HealthCheck/HealthCheckAlarmBuilder ([#95](https://github.com/laazyj/composureCDK/pull/95), [#84](https://github.com/laazyj/composureCDK/issues/84))
- ⚠️ **s3:** wire BucketBuilder to taggedBuilder for builder-level .tag() / .tags() ([a8bd4d0](https://github.com/laazyj/composureCDK/commit/a8bd4d0))
- **s3:** add [COPY_STATE] to Bucket/BucketDeploymentBuilder ([#96](https://github.com/laazyj/composureCDK/pull/96), [#84](https://github.com/laazyj/composureCDK/issues/84))
- **sns:** add [COPY_STATE] to TopicBuilder ([#97](https://github.com/laazyj/composureCDK/pull/97), [#84](https://github.com/laazyj/composureCDK/issues/84))

### ⚠️ Breaking Changes

- roll taggedBuilder out across remaining builders + lint enforcement ([1e6a517](https://github.com/laazyj/composureCDK/commit/1e6a517))
  the migrated builders' `IXxxBuilder` aliases now
  structurally extend `ITaggedBuilder` instead of `IBuilder`. Pure
  consumers that destructure or annotate against the old shape need to
  recompile. Pre-1.0; release-please will pick up the bump.
- **cloudformation:** route StackBuilder through taggedBuilder, drop bespoke #tags ([5246f65](https://github.com/laazyj/composureCDK/commit/5246f65))
  `StackBuilder.tag()`'s duplicate-key behaviour: previously
  silent (last-wins observable in CFN tags), now last-wins with a
  `process.emitWarning`. Functionally compatible; previously-quiet duplicate
  calls now emit a warning. Pre-1.0; release-please will pick up the bump.
- **s3:** wire BucketBuilder to taggedBuilder for builder-level .tag() / .tags() ([a8bd4d0](https://github.com/laazyj/composureCDK/commit/a8bd4d0))
  the `IBucketBuilder` alias structurally extends
  `ITaggedBuilder` instead of `IBuilder`. Pre-1.0; release-please will
  pick up the bump.

### ❤️ Thank You

- Claude (laazyj)
- Claude Opus 4.7 (1M context)
- Jason Duffett

## 0.6.0 (2026-05-07)

### 🚀 Features

- ⚠️ **budgets:** encode service constraints in NotifySubscribers + Email ([#75](https://github.com/laazyj/composureCDK/pull/75))
- ⚠️ **cloudformation:** consume Lifecycle<StackBuilderResult> in singleStack/groupedStacks; drop toScopeFactory ([#78](https://github.com/laazyj/composureCDK/issues/78))
- **core:** add .copy() to Builder via COPY_STATE hook ([cfc9d02](https://github.com/laazyj/composureCDK/commit/cfc9d02))

### 🩹 Fixes

- **release-tag:** allow GitHub squash-merge `(#NN)` suffix ([#73](https://github.com/laazyj/composureCDK/pull/73), [#72](https://github.com/laazyj/composureCDK/issues/72))

### ⚠️ Breaking Changes

- **cloudformation:** consume Lifecycle<StackBuilderResult> in singleStack/groupedStacks; drop toScopeFactory ([#78](https://github.com/laazyj/composureCDK/issues/78))
  singleStack and groupedStacks in
  @composurecdk/cloudformation now take a Lifecycle<StackBuilderResult>
  instead of a ScopeFactory. StackBuilder.toScopeFactory() is removed.
  Pre-1.0; release-please will pick up the major bump on the
  cloudformation package.
- **budgets:** encode service constraints in NotifySubscribers + Email ([#75](https://github.com/laazyj/composureCDK/pull/75))
  `notifyOnActual`, `notifyOnForecasted`,
  `withRecommendedThresholds`, and `NotificationEntry.subscribers` now
  take a `NotifySubscribers` object instead of variadic
  `BudgetSubscriber` arguments. Email addresses must be constructed via
  `email("addr@host")`. The `BudgetSubscriber` type is removed.
  Migration:
  before: .notifyOnActual(100, alertTopic, "ops@example.com")
  after: .notifyOnActual(100, { sns: alertTopic, emails: [email("ops@example.com")] })

### ❤️ Thank You

- Jason Duffett

## 0.5.1 (2026-05-02)

### 🚀 Features

- **ec2:** add InstanceBuilder and VpcBuilder with well-architected d… ([#48](https://github.com/laazyj/composureCDK/pull/48), [#33](https://github.com/laazyj/composureCDK/issues/33))

### 🩹 Fixes

- **release:** move git config under version/changelog subcommands ([#71](https://github.com/laazyj/composureCDK/pull/71))

### ❤️ Thank You

- Jason Duffett

## 0.5.0 (2026-04-30)

### 🚀 Features

- ⚠️ **cloudfront:** collapse access-log props into accessLogs config ([#63](https://github.com/laazyj/composureCDK/pull/63))
- ⚠️ **s3:** collapse access-log props into serverAccessLogs config ([7d01550](https://github.com/laazyj/composureCDK/commit/7d01550))
- ⚠️ **s3,cloudfront:** add default bucket lifecycle rules ([e82dff0](https://github.com/laazyj/composureCDK/commit/e82dff0))

### ⚠️ Breaking Changes

- **s3,cloudfront:** add default bucket lifecycle rules ([e82dff0](https://github.com/laazyj/composureCDK/commit/e82dff0))
  buckets created with createBucketBuilder now have
  LifecycleConfiguration applied by default. Consumers upgrading with
  existing versioned buckets will start expiring noncurrent versions
  older than 365 days on the next lifecycle pass; pass an explicit
  .lifecycleRules([...]) to opt out or supply different rules.
- **cloudfront:** collapse access-log props into accessLogs config ([#63](https://github.com/laazyj/composureCDK/pull/63))
  DistributionBuilder no longer accepts accessLogging,
  logBucket, logFilePrefix, or logIncludesCookies. Migration:
  .accessLogging(true) -> (remove; default)
  .accessLogging(false) -> .accessLogs(false)
  .logBucket(b) -> .accessLogs({ destination: b })
  .logBucket(b).logFilePrefix("x/") -> .accessLogs({ destination: b, prefix: "x/" })
  .logFilePrefix("x/") -> .accessLogs({ prefix: "x/" })
  .logIncludesCookies(true) -> .accessLogs({ includeCookies: true })
- **s3:** collapse access-log props into serverAccessLogs config ([7d01550](https://github.com/laazyj/composureCDK/commit/7d01550))
  BucketBuilder no longer accepts accessLogging,
  accessLogsPrefix, serverAccessLogsBucket, or serverAccessLogsPrefix.
  Migration:
  .accessLogging(false) -> .serverAccessLogs(false)
  .accessLogging(true) -> (remove; default)
  .accessLogsPrefix("x/") -> .serverAccessLogs({ prefix: "x/" })
  .serverAccessLogsBucket(b) -> .serverAccessLogs({ destination: b })
  .serverAccessLogsBucket(b)
  .serverAccessLogsPrefix("x/") -> .serverAccessLogs({ destination: b, prefix: "x/" })

### ❤️ Thank You

- Jason Duffett

## 0.4.8 (2026-04-29)

### 🚀 Features

- **budgets:** add BudgetBuilder with recommended thresholds and alarms ([#40](https://github.com/laazyj/composureCDK/pull/40))

### ❤️ Thank You

- Jason Duffett

## 0.4.7 (2026-04-28)

### 🚀 Features

- **cloudwatch:** explicit, readable alarm names with override seam ([#62](https://github.com/laazyj/composureCDK/pull/62))

### ❤️ Thank You

- Jason Duffett

## 0.4.6 (2026-04-27)

### 🚀 Features

- **route53:** add health check builder with recommended alarm ([#59](https://github.com/laazyj/composureCDK/pull/59), [#58](https://github.com/laazyj/composureCDK/issues/58), [#45](https://github.com/laazyj/composureCDK/issues/45))

### ❤️ Thank You

- Jason Duffett

## 0.4.5 (2026-04-25)

### 🚀 Features

- **cloudfront:** standalone alarm builder ([#58](https://github.com/laazyj/composureCDK/pull/58), [#55](https://github.com/laazyj/composureCDK/issues/55))

### 🩹 Fixes

- **core:** propagate parent context into nested compose ([#57](https://github.com/laazyj/composureCDK/pull/57), [#51](https://github.com/laazyj/composureCDK/issues/51))

### ❤️ Thank You

- Jason Duffett

## 0.4.4 (2026-04-24)

### 🚀 Features

- **cloudfront:** first-class cache behaviors and inline functions ([#53](https://github.com/laazyj/composureCDK/pull/53), [#32](https://github.com/laazyj/composureCDK/issues/32))

### 🩹 Fixes

- **ci:** trigger sandbox-cleanup after Release workflow ([1e60f1b](https://github.com/laazyj/composureCDK/commit/1e60f1b))
- **examples:** close access-logs teardown race ([d7f1bab](https://github.com/laazyj/composureCDK/commit/d7f1bab))

### ❤️ Thank You

- Jason Duffett

## 0.4.3 (2026-04-23)

### 🚀 Features

- **cloudwatch:** add alarmActionsPolicy helper ([37cb0f2](https://github.com/laazyj/composureCDK/commit/37cb0f2))

### 🩹 Fixes

- **ci:** grant ListStackResources to sandbox cleanup role ([1aee8ee](https://github.com/laazyj/composureCDK/commit/1aee8ee))

### ❤️ Thank You

- Jason Duffett

## 0.4.2 (2026-04-22)

### 🚀 Features

- **route53:** add ALIAS helper to the zone DSL ([59dddb7](https://github.com/laazyj/composureCDK/commit/59dddb7))

### ❤️ Thank You

- Jason Duffett

## 0.4.1 (2026-04-22)

### 🩹 Fixes

- **release:** include @composurecdk/examples in the release group ([58b5d69](https://github.com/laazyj/composureCDK/commit/58b5d69))

### ❤️ Thank You

- Jason Duffett

## 0.4.0 (2026-04-22)

### 🚀 Features

- **cloudformation:** route outputs per-stack via OutputDefinition.scope ([6dcf748](https://github.com/laazyj/composureCDK/commit/6dcf748))
- ⚠️ **core:** pass per-component scopes to afterBuild hooks ([f08a7fa](https://github.com/laazyj/composureCDK/commit/f08a7fa))

### 🩹 Fixes

- re-export \*BuilderProps from package barrels ([364926d](https://github.com/laazyj/composureCDK/commit/364926d))
- use ECMAScript private fields in builder classes ([ec79283](https://github.com/laazyj/composureCDK/commit/ec79283))
- **route53:** bump @composurecdk/core peer dep to ^0.3.6 ([e5538e8](https://github.com/laazyj/composureCDK/commit/e5538e8))
- **route53:** use ECMAScript private fields in ZoneRecordsBuilder ([84c01e8](https://github.com/laazyj/composureCDK/commit/84c01e8))
- **route53:** use readable "Apex" as apex record construct id ([05b7345](https://github.com/laazyj/composureCDK/commit/05b7345))

### ⚠️ Breaking Changes

- **core:** pass per-component scopes to afterBuild hooks ([f08a7fa](https://github.com/laazyj/composureCDK/commit/f08a7fa))
  AfterBuildHook<T> now requires a fourth parameter
  componentScopes: { readonly [K in keyof T]: IConstruct }. Custom
  hook implementations must add this parameter to their signature;
  hooks that do not need it can accept it as \_componentScopes.

### ❤️ Thank You

- Jason Duffett

## 0.3.6 (2026-04-21)

### 🚀 Features

- **core:** add constructId sanitizer ([#54](https://github.com/laazyj/composureCDK/pull/54))
- **route53:** add BIND-style zone DSL ([#50](https://github.com/laazyj/composureCDK/pull/50))

### ❤️ Thank You

- Jason Duffett

## 0.3.5 (2026-04-20)

### 🚀 Features

- **route53:** add support for additional record types ([2a5a23a](https://github.com/laazyj/composureCDK/commit/2a5a23a))

### ❤️ Thank You

- Jason Duffett

## 0.3.4 (2026-04-19)

### 🚀 Features

- **route53:** add hosted zone and record builders ([#46](https://github.com/laazyj/composureCDK/pull/46), [#44](https://github.com/laazyj/composureCDK/issues/44), [#45](https://github.com/laazyj/composureCDK/issues/45), [#30](https://github.com/laazyj/composureCDK/issues/30))

### ❤️ Thank You

- Jason Duffett

## 0.3.3 (2026-04-19)

### 🚀 Features

- **acm:** add CertificateBuilder with DaysToExpiry alarm ([#43](https://github.com/laazyj/composureCDK/pull/43), [#31](https://github.com/laazyj/composureCDK/issues/31))

### ❤️ Thank You

- Jason Duffett

## 0.3.2 (2026-04-18)

### 🚀 Features

- **cloudfront:** accept Resolvable<ICertificate> on DistributionBuilder ([#22](https://github.com/laazyj/composureCDK/pull/22))

### 🩹 Fixes

- **cloudfront:** add dependency to control deletion order ([88443a2](https://github.com/laazyj/composureCDK/commit/88443a2))

### ❤️ Thank You

- Jason Duffett

## 0.3.1 (2026-04-18)

### 🚀 Features

- **iam:** add RoleBuilder, ManagedPolicyBuilder, and StatementBuilder ([#36](https://github.com/laazyj/composureCDK/pull/36), [#28](https://github.com/laazyj/composureCDK/issues/28), [#29](https://github.com/laazyj/composureCDK/issues/29))
- **sns:** add SubscriptionBuilder ([#19](https://github.com/laazyj/composureCDK/pull/19))
- **sns:** add TopicBuilder.addSubscription via ITopicSubscription.bind() ([#39](https://github.com/laazyj/composureCDK/pull/39), [#38](https://github.com/laazyj/composureCDK/issues/38))

### 🩹 Fixes

- **ci:** make deploy-test more resilient when destroying stacks ([cc0ccf9](https://github.com/laazyj/composureCDK/commit/cc0ccf9))
- **s3:** disable versioning on access logging buckets ([4f7473a](https://github.com/laazyj/composureCDK/commit/4f7473a))

### ❤️ Thank You

- Jason Duffett

## 0.3.0 (2026-04-10)

### 🚀 Features

- **apigateway:** add AWS recommended alarms ([#13](https://github.com/laazyj/composureCDK/issues/13))
- **cloudwatch:** add cloudwatch package for working with Alarms ([#13](https://github.com/laazyj/composureCDK/issues/13))
- **cloudwatch:** add AWS recommended alarms ([30bbd98](https://github.com/laazyj/composureCDK/commit/30bbd98))
- **lambda:** add AWS recommended alarms ([d7dadef](https://github.com/laazyj/composureCDK/commit/d7dadef))
- **s3:** add AWS recommended alarms ([0b3f95f](https://github.com/laazyj/composureCDK/commit/0b3f95f))
- **sns:** add TopicBuilder with recommended alarms ([#16](https://github.com/laazyj/composureCDK/issues/16))

### ❤️ Thank You

- Jason Duffett

## 0.2.0 (2026-04-06)

### 🚀 Features

- **apigateway:** add SpecRestApiBuilder ([4924565](https://github.com/laazyj/composureCDK/commit/4924565))
- **examples:** clean-desk-policy auto deletes S3 objects ([d76c310](https://github.com/laazyj/composureCDK/commit/d76c310))
- **examples:** add Static Website example ([09a1ffb](https://github.com/laazyj/composureCDK/commit/09a1ffb))
- **examples:** demonstrate ApiGateway from OpenAPI specification ([5e8360a](https://github.com/laazyj/composureCDK/commit/5e8360a))

### 🩹 Fixes

- **cloudfront:** enable ACLs on Access Logging bucket ([31beb8b](https://github.com/laazyj/composureCDK/commit/31beb8b))

### ❤️ Thank You

- Jason Duffett

## 0.1.3 (2026-04-03)

### 🚀 Features

- **cloudformation:** add extension for CfnOutputs ([bd1f6ea](https://github.com/laazyj/composureCDK/commit/bd1f6ea))
- **core:** add afterBuild extensions ([a79f809](https://github.com/laazyj/composureCDK/commit/a79f809))
- **examples:** add a CleanDeskPolicy to clear examples on destroy ([d9a19d7](https://github.com/laazyj/composureCDK/commit/d9a19d7))
- **lambda:** add managed LogGroup to FunctionBuilder ([87afac0](https://github.com/laazyj/composureCDK/commit/87afac0))
- **s3:** add BucketDeploymentBuilder ([2845a7d](https://github.com/laazyj/composureCDK/commit/2845a7d))

### 🩹 Fixes

- **ci:** regenerate lockfile with cross-platform bindings ([8a010e6](https://github.com/laazyj/composureCDK/commit/8a010e6))
- **examples:** update snapshots with managed Lambda log groups ([54b74c0](https://github.com/laazyj/composureCDK/commit/54b74c0))

### ❤️ Thank You

- Jason Duffett

## 0.1.2 (2026-04-01)

### 🚀 Features

- **cloudfront:** add CloudFront Distribution builder ([7eaae0e](https://github.com/laazyj/composureCDK/commit/7eaae0e))
- **s3:** add S3 package ([9b3518f](https://github.com/laazyj/composureCDK/commit/9b3518f))

### 🩹 Fixes

- **ci:** create GitHub release after successful publish ([7cac1eb](https://github.com/laazyj/composureCDK/commit/7cac1eb))

### ❤️ Thank You

- Jason Duffett

## 0.1.1 (2026-03-30)

### 🚀 Features

- **apigateway:** add RestApi support ([5f9d025](https://github.com/laazyj/composureCDK/commit/5f9d025))
- **apigateway:** add "Well-Architected" defaults to RestApiBuilder ([cd6e8c5](https://github.com/laazyj/composureCDK/commit/cd6e8c5))
- **cloudformation:** add StackBuilder ([aa1f33d](https://github.com/laazyj/composureCDK/commit/aa1f33d))
- **core:** add initial lifecycle and compose function ([1c45788](https://github.com/laazyj/composureCDK/commit/1c45788))
- **core:** add Builder interface ([e514a1b](https://github.com/laazyj/composureCDK/commit/e514a1b))
- **core:** add refs to glue dependencies at build time ([bcce3db](https://github.com/laazyj/composureCDK/commit/bcce3db))
- **core:** add stack management extension ([6ca60f5](https://github.com/laazyj/composureCDK/commit/6ca60f5))
- **core:** add Stack Stategy support ([d9ef020](https://github.com/laazyj/composureCDK/commit/d9ef020))
- **examples:** add examples package demonstrating usage ([1b3cd0d](https://github.com/laazyj/composureCDK/commit/1b3cd0d))
- **examples:** add support for deploying example apps ([b0a7280](https://github.com/laazyj/composureCDK/commit/b0a7280))
- **lambda:** create lambda package with basic functionality ([558f1f5](https://github.com/laazyj/composureCDK/commit/558f1f5))
- **lambda:** add "well-architected" defaults ([a7a1ea5](https://github.com/laazyj/composureCDK/commit/a7a1ea5))
- **logs:** add LogGroupBuilder with secure defaults ([4108918](https://github.com/laazyj/composureCDK/commit/4108918))

### 🩹 Fixes

- ci must build monorepo before lint ([636976c](https://github.com/laazyj/composureCDK/commit/636976c))
- **ci:** add ListStacks permission for smoke test ([#3](https://github.com/laazyj/composureCDK/issues/3))
- **ci:** use list-stacks then per-stack describe in smoke test ([#3](https://github.com/laazyj/composureCDK/issues/3))

### ❤️ Thank You

- Jason Duffett
