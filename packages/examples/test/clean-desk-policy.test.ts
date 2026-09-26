import { beforeAll, describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Size } from "aws-cdk-lib";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Volume } from "aws-cdk-lib/aws-ec2";
import { MockIntegration, RestApi, type RestApiProps } from "aws-cdk-lib/aws-apigateway";
import { cleanDeskPolicy } from "../src/clean-desk-policy.js";
import { buildExampleApp } from "../src/apps.js";
import { exampleApp } from "../src/app-context.js";
import { createAgentVolumeApp } from "../src/agent-volume-app.js";
import { createCrudApiApp } from "../src/crud-api-app.js";
import { createDynamoStreamProcessorApp } from "../src/dynamo-stream-processor-app.js";
import { createMockApiApp } from "../src/mock-api-app.js";
import { createNeptuneGraphApp } from "../src/neptune-graph-app.js";
import { createOrderProcessorApp } from "../src/order-processor-app.js";
import { createStaticWebsiteApp } from "../src/static-website/app.js";

function restApi(stack: Stack, props: Partial<RestApiProps> = {}): void {
  const api = new RestApi(stack, "Api", { restApiName: "TestApi", ...props });
  api.root.addMethod("GET", new MockIntegration());
}

function buildWithPolicy(
  buildFn: (stack: Stack) => void,
  context?: Record<string, unknown>,
): Template {
  const app = new App({ context });
  cleanDeskPolicy(app);
  const stack = new Stack(app, "TestStack");
  buildFn(stack);
  return Template.fromStack(stack);
}

describe("cleanDeskPolicy", () => {
  it("overrides S3 bucket removal policy to DESTROY", () => {
    const template = buildWithPolicy((stack) => {
      new Bucket(stack, "Bucket");
    });

    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("overrides EBS Volume removal policy to DESTROY (overriding the RETAIN default)", () => {
    const template = buildWithPolicy((stack) => {
      new Volume(stack, "Vol", {
        availabilityZone: "us-east-1a",
        size: Size.gibibytes(10),
      });
    });

    template.hasResource("AWS::EC2::Volume", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("sets the agent-volume stack's persistent EBS volume to Delete", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createAgentVolumeApp(app);
    const template = Template.fromStack(stack);

    template.hasResource("AWS::EC2::Volume", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("sets the neptune-graph stack's cluster to Delete and clears deletion protection", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createNeptuneGraphApp(app);
    const template = Template.fromStack(stack);

    template.hasResource("AWS::Neptune::DBCluster", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    template.hasResourceProperties("AWS::Neptune::DBCluster", {
      DeletionProtection: false,
    });
  });

  it("sets the crud-api stack's table to Delete and clears deletion protection", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createCrudApiApp(app);
    const template = Template.fromStack(stack);

    template.hasResource("AWS::DynamoDB::Table", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    template.hasResourceProperties("AWS::DynamoDB::Table", {
      DeletionProtectionEnabled: false,
    });
  });

  it("sets the crud-api stack's KMS key to Delete with the 7-day minimum window", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createCrudApiApp(app);
    const template = Template.fromStack(stack);

    template.hasResource("AWS::KMS::Key", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
    // 7 days is the AWS minimum for ScheduleKeyDeletion — there is no
    // immediate delete, so a torn-down sandbox key still bills for a week.
    template.hasResourceProperties("AWS::KMS::Key", { PendingWindowInDays: 7 });
  });

  it("sets all resources to Delete in the dynamo-stream-processor stack", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createDynamoStreamProcessorApp(app);
    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { DeletionPolicy?: string }>;

    // Covers the DLQ (already Delete by default) and the table, whose stream —
    // and the event source mapping consuming it — go with the table itself.
    const retainedResources = Object.entries(resources)
      .filter(([, resource]) => resource.DeletionPolicy === "Retain")
      .map(([logicalId]) => logicalId);

    expect(retainedResources).toEqual([]);
    // Deletion protection is the half a DeletionPolicy sweep cannot see.
    template.hasResourceProperties("AWS::DynamoDB::GlobalTable", {
      Replicas: Match.arrayWith([Match.objectLike({ DeletionProtectionEnabled: false })]),
    });
  });

  describe("order-processor stack (Bedrock)", () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      cleanDeskPolicy(app);
      const { stack } = createOrderProcessorApp(app);
      template = Template.fromStack(stack);
    });

    // The model invocation log group is the one Bedrock-built resource that
    // defaults to RETAIN; it is an L2 `LogGroup`, so the LogGroup injector
    // covers it without a Bedrock-specific one.
    it("sets the invocation-logging and processor log groups to Delete", () => {
      const logGroups = Object.values(
        template.findResources("AWS::Logs::LogGroup") as Record<
          string,
          { DeletionPolicy?: string }
        >,
      );

      expect(logGroups).toHaveLength(2);
      expect(logGroups.map((logGroup) => logGroup.DeletionPolicy)).toEqual(["Delete", "Delete"]);
    });

    // The guardrail, its version and the application inference profile are
    // L1s with no removal policy, so CloudFormation's default (Delete) applies.
    // Fails if a builder starts retaining one, which would need an injector.
    it("leaves the guardrail, its version and the inference profile on CloudFormation's default", () => {
      for (const type of [
        "AWS::Bedrock::Guardrail",
        "AWS::Bedrock::GuardrailVersion",
        "AWS::Bedrock::ApplicationInferenceProfile",
      ]) {
        const resources = Object.values(
          template.findResources(type) as Record<string, { DeletionPolicy?: string }>,
        );
        expect(resources, type).toHaveLength(1);
        expect(resources[0]?.DeletionPolicy, type).toBeUndefined();
      }
    });

    // Invocation logging is account-wide per Region, so a torn-down stack
    // must switch it off rather than leave Bedrock writing to a deleted log
    // group with a deleted role.
    it("turns account-wide model invocation logging off on delete", () => {
      const [configuration] = Object.values(
        template.findResources("Custom::AWS") as Record<
          string,
          { Properties: { Delete?: unknown } }
        >,
      );

      expect(JSON.stringify(configuration.Properties.Delete)).toContain(
        "DeleteModelInvocationLoggingConfiguration",
      );
    });

    it("leaves nothing Retained", () => {
      const resources = template.toJSON().Resources as Record<string, { DeletionPolicy?: string }>;
      const retained = Object.entries(resources)
        .filter(([, resource]) => resource.DeletionPolicy === "Retain")
        .map(([logicalId]) => logicalId);

      expect(retained).toEqual([]);
    });
  });

  it("overrides LogGroup removal policy to DESTROY", () => {
    const template = buildWithPolicy((stack) => {
      new LogGroup(stack, "LG", { retention: RetentionDays.ONE_WEEK });
    });

    template.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  it("overrides RestApi Account and CloudWatch Role removal policy to DESTROY", () => {
    const template = buildWithPolicy(restApi);

    template.hasResource("AWS::ApiGateway::Account", {
      DeletionPolicy: "Delete",
      UpdateReplacePolicy: "Delete",
    });
  });

  // Without the guard these throw at synth: "'cloudWatchRole' must be enabled
  // for 'cloudWatchRoleRemovalPolicy' to be applied."
  it("still synthesises when the feature flag disables the CloudWatch Role", () => {
    const template = buildWithPolicy(restApi, {
      "@aws-cdk/aws-apigateway:disableCloudWatchRole": true,
    });

    template.resourceCountIs("AWS::ApiGateway::Account", 0);
  });

  it("still synthesises when the caller disables the CloudWatch Role", () => {
    const template = buildWithPolicy((stack) => {
      restApi(stack, { cloudWatchRole: false });
    });

    template.resourceCountIs("AWS::ApiGateway::Account", 0);
  });

  // The flag only supplies the default, so an explicit `true` still wins and
  // the removal policy still has to be applied.
  it("overrides the removal policy when the caller re-enables the role", () => {
    const template = buildWithPolicy(
      (stack) => {
        restApi(stack, { cloudWatchRole: true });
      },
      { "@aws-cdk/aws-apigateway:disableCloudWatchRole": true },
    );

    template.hasResource("AWS::ApiGateway::Account", { DeletionPolicy: "Delete" });
  });

  it("does not affect stacks without the policy", () => {
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new Bucket(stack, "Bucket");
    new LogGroup(stack, "LG", { retention: RetentionDays.ONE_WEEK });
    const template = Template.fromStack(stack);

    template.hasResource("AWS::S3::Bucket", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
    template.hasResource("AWS::Logs::LogGroup", {
      DeletionPolicy: "Retain",
      UpdateReplacePolicy: "Retain",
    });
  });

  it("sets all resources to Delete in a full example stack", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createMockApiApp(app);
    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { DeletionPolicy?: string }>;

    const retainedResources = Object.entries(resources)
      .filter(([, resource]) => resource.DeletionPolicy === "Retain")
      .map(([logicalId]) => logicalId);

    expect(retainedResources).toEqual([]);
  });

  it("sets all resources to Delete in the static website stack", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createStaticWebsiteApp(app);
    const template = Template.fromStack(stack);
    const resources = template.toJSON().Resources as Record<string, { DeletionPolicy?: string }>;

    const retainedResources = Object.entries(resources)
      .filter(([, resource]) => resource.DeletionPolicy === "Retain")
      .map(([logicalId]) => logicalId);

    expect(retainedResources).toEqual([]);
  });

  it("sets CloudFront access logs bucket to Delete when cleanDeskPolicy is applied", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createStaticWebsiteApp(app);
    const template = Template.fromStack(stack);
    const buckets = template.findResources("AWS::S3::Bucket");

    // All 3 buckets (site, S3 access logs, CloudFront access logs) should have Delete policy
    const bucketPolicies = Object.values(buckets).map(
      (bucket) => (bucket as { DeletionPolicy?: string }).DeletionPolicy,
    );

    expect(bucketPolicies).toEqual(["Delete", "Delete", "Delete"]);
  });

  it("creates autoDeleteObjects custom resources for all buckets when cleanDeskPolicy is applied", () => {
    const app = new App();
    cleanDeskPolicy(app);
    const { stack } = createStaticWebsiteApp(app);
    const template = Template.fromStack(stack);

    const buckets = template.findResources("AWS::S3::Bucket");
    const autoDeleteResources = template.findResources("Custom::S3AutoDeleteObjects");

    // Should have 3 buckets and 3 autoDelete custom resources
    expect(Object.keys(buckets).length).toBe(3);
    expect(Object.keys(autoDeleteResources).length).toBe(3);

    // Each bucket should have a corresponding autoDelete resource
    const bucketIds = Object.keys(buckets);
    const autoDeleteBucketRefs = Object.values(autoDeleteResources).map(
      (resource) =>
        (resource as { Properties?: { BucketName?: { Ref?: string } } }).Properties?.BucketName
          ?.Ref,
    );

    for (const bucketId of bucketIds) {
      expect(autoDeleteBucketRefs).toContain(bucketId);
    }
  });

  describe("disable-logging-on-delete aspect", () => {
    let template: Template;

    beforeAll(() => {
      const app = new App();
      cleanDeskPolicy(app);
      const { stack } = createStaticWebsiteApp(app);
      template = Template.fromStack(stack);
    });

    it("creates a Custom::DisableBucketLogging for each bucket that is a server-access-logging source", () => {
      // Only the site bucket has serverAccessLogsBucket wired in the static
      // website stack (the S3 access-logs bucket and the CloudFront logs
      // bucket are destinations, not sources).
      template.resourceCountIs("Custom::DisableBucketLogging", 1);
    });

    it("scopes the IAM policy to s3:PutBucketLogging on the source bucket only", () => {
      template.hasResourceProperties(
        "AWS::IAM::Policy",
        Match.objectLike({
          PolicyDocument: Match.objectLike({
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: "s3:PutBucketLogging",
                Effect: "Allow",
                Resource: Match.objectLike({
                  "Fn::GetAtt": Match.arrayWith([Match.stringLikeRegexp("StaticWebsitesite")]),
                }),
              }),
            ]),
          }),
        }),
      );
    });

    it("encodes putBucketLogging with empty BucketLoggingStatus in the onDelete payload", () => {
      const resources = template.findResources("Custom::DisableBucketLogging");
      const [cr] = Object.values(resources);
      const deletePayload = (cr as { Properties: { Delete?: unknown } }).Properties.Delete;
      expect(deletePayload).toBeDefined();

      // AwsCustomResource inlines the SDK call as a JSON-stringified blob;
      // because `Bucket` is a Ref token, it's rendered as a `Fn::Join` whose
      // string segments contain the literal JSON. Serialise once and regex
      // to tolerate token interpolation.
      const serialized = JSON.stringify(deletePayload);
      expect(serialized).toContain("putBucketLogging");
      expect(serialized).toContain("BucketLoggingStatus");
    });

    it("orders the disable-logging CR before the source bucket's autoDelete CR", () => {
      // The disable-logging CR DependsOn the source's autoDelete CR. CFN
      // reverses create order on delete, so disableLoggingCR.onDelete fires
      // BEFORE source.autoDelete empties the source bucket — which is what
      // prevents the source-deletion DELETE calls from emitting access logs
      // that would race the logs-bucket teardown.
      const disableCrs = template.findResources("Custom::DisableBucketLogging");
      const [, disableCrResource] = Object.entries(disableCrs)[0] as [
        string,
        { DependsOn?: string[] },
      ];
      const autoDeletes = template.findResources("Custom::S3AutoDeleteObjects");
      const sourceAutoDeleteId = Object.keys(autoDeletes).find((logicalId) =>
        logicalId.startsWith("StaticWebsitesiteAutoDelete"),
      );
      expect(sourceAutoDeleteId).toBeDefined();
      expect(disableCrResource.DependsOn).toContain(sourceAutoDeleteId);
    });

    it("adds no disable-logging CR for stacks without server access logging", () => {
      const app = new App();
      cleanDeskPolicy(app);
      const { stack } = createMockApiApp(app);
      const mockApiTemplate = Template.fromStack(stack);

      mockApiTemplate.resourceCountIs("Custom::DisableBucketLogging", 0);
    });
  });
  // The injector registry is hand-maintained, and a construct type missing from
  // it fails silently — the stack just leaves resources behind on teardown.
  // This is the assertion that catches that: it swept up the SpecRestApi gap
  // (an orphaned ApiGateway Account and CloudWatch Role in the petstore stack)
  // that the per-type tests above could not see.
  it("leaves nothing Retained across every example stack", () => {
    const retained = buildExampleApp(exampleApp({ outdir: "cdk.out/clean-desk-sweep" }))
      .synth()
      .stacks.flatMap(({ stackName, template }) =>
        Object.entries(
          (template as { Resources?: Record<string, { DeletionPolicy?: string }> }).Resources ?? {},
        )
          .filter(([, resource]) => resource.DeletionPolicy === "Retain")
          .map(([logicalId]) => `${stackName}/${logicalId}`),
      );

    expect(retained).toEqual([]);
  });
});
