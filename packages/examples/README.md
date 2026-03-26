# Examples

Example applications demonstrating ComposureCDK patterns. Each example is a self-contained CDK stack that can be synthesised and deployed to an AWS account.

| Stack                                           | Description                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| [`DualFunctionStack`](src/dual-function-app.ts) | Two Lambda functions (API handler + async worker) with different configurations |
| [`LambdaApiStack`](src/lambda-api-app.ts)       | REST API backed by a Lambda function, wired with `ref`                          |
| [`MockApiStack`](src/mock-api-app.ts)           | CRUD REST API with mock integrations                                            |

## Prerequisites

1. **AWS Account** — We recommend a dedicated test/sandbox account, not production.
2. **AWS Credentials** — Configure credentials via `aws configure`, SSO, environment variables, or a named profile (`export AWS_PROFILE=my-sandbox`). See [AWS CLI configuration](https://docs.aws.amazon.com/cli/latest/userguide/cli-chap-configure.html).
3. **CDK Bootstrap** — One-time per account/region: `npx nx cdk examples -- bootstrap`

## Usage

```sh
npx nx build examples                                    # build examples and dependencies
npx nx synth examples -- --list                           # list available stacks
npx nx synth examples -- DualFunctionStack                # synthesise a stack to cdk.out/
npx nx deploy examples -- DualFunctionStack               # deploy a stack
npx nx deploy examples -- DualFunctionStack LambdaApiStack  # deploy multiple stacks
npx nx cdk examples -- destroy DualFunctionStack          # tear down a stack
npx nx cdk examples -- destroy --all                      # tear down all example stacks
```

To skip IAM approval prompts (e.g. in CI): add `--require-approval never` to deploy commands.

## Costs

These examples create minimal resources (Lambda functions, API Gateway endpoints) and should fall within the [AWS Free Tier](https://aws.amazon.com/free/). Destroy stacks when done to avoid unexpected charges.
