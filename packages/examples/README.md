# Examples

Example applications demonstrating ComposureCDK patterns. Each example is a self-contained CDK stack that can be synthesised and deployed to an AWS account.

All example stacks use the `ComposureCDK-` name prefix. This convention enables the CI deploy-test pipeline to scope IAM permissions and discover stacks automatically — see [CI documentation](../../docs/ci.md#stack-naming-convention) for details. **New examples must follow this prefix.**

| Stack                                                                                               | Description                                                                     |
| --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| [`ComposureCDK-DualFunctionStack`](src/dual-function-app.ts)                                        | Two Lambda functions (API handler + async worker) with different configurations |
| [`ComposureCDK-LambdaApiStack`](src/lambda-api-app.ts)                                              | REST API backed by a Lambda function, wired with `ref`                          |
| [`ComposureCDK-MockApiStack`](src/mock-api-app.ts)                                                  | CRUD REST API with mock integrations                                            |
| [`ComposureCDK-MultiStackServiceStack` / `ComposureCDK-MultiStackApiStack`](src/multi-stack-app.ts) | REST API + Lambda split across two stacks via `.withStacks()`                   |
| [`ComposureCDK-StaticWebsiteStack`](src/static-website/app.ts)                                      | S3 + CloudFront static website with OAC, error pages, and content deployment    |
| [`ComposureCDK-StrategyStackApp-*`](src/strategy-stack-app.ts)                                      | REST API + Lambda split across stacks via `.withStackStrategy()`                |

## Prerequisites

1. **AWS Account** — We recommend a dedicated test/sandbox account, not production.
2. **AWS Credentials** — Configure credentials via `aws configure`, SSO, environment variables, or a named profile (`export AWS_PROFILE=my-sandbox`). See [AWS CLI configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html).
3. **CDK Bootstrap** — One-time per account/region: `npx nx cdk examples -- bootstrap`

## Usage

```sh
npx nx build examples                                                        # build examples and dependencies
npx nx synth examples -- --list                                               # list available stacks
npx nx synth examples -- ComposureCDK-DualFunctionStack                       # synthesise a stack to cdk.out/
npx nx deploy examples -- ComposureCDK-DualFunctionStack                      # deploy a stack
npx nx deploy examples -- ComposureCDK-DualFunctionStack ComposureCDK-LambdaApiStack  # deploy multiple stacks
npx nx cdk examples -- destroy ComposureCDK-DualFunctionStack                 # tear down a stack
npx nx cdk examples -- destroy --all                                          # tear down all example stacks
```

To skip IAM approval prompts (e.g. in CI): add `--require-approval never` to deploy commands.

## Costs

These examples create minimal resources (Lambda functions, API Gateway endpoints, S3 buckets, CloudFront distributions) and should fall within the [AWS Free Tier](https://aws.amazon.com/free/). Destroy stacks when done to avoid unexpected charges.
