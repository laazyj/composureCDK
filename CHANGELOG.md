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
