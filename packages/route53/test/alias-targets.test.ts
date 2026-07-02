import { describe, it, expect } from "vitest";
import { App, Stack } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { DomainName, EndpointType, LambdaIntegration, RestApi } from "aws-cdk-lib/aws-apigateway";
import { Code, Function as LambdaFn, Runtime } from "aws-cdk-lib/aws-lambda";
import { Certificate } from "aws-cdk-lib/aws-certificatemanager";
import { PublicHostedZone } from "aws-cdk-lib/aws-route53";
import { isRef, ref } from "@composurecdk/core";
import { createARecordBuilder } from "../src/a-record-builder.js";
import {
  apiGatewayAliasTarget,
  apiGatewayDomainAliasTarget,
  cloudfrontAliasTarget,
} from "../src/alias-targets.js";

function testScope() {
  const app = new App();
  const stack = new Stack(app, "TestStack");
  const zone = new PublicHostedZone(stack, "Zone", { zoneName: "example.com" });
  return { stack, zone };
}

describe("cloudfrontAliasTarget", () => {
  it("returns a Ref-based target for a Ref<IDistribution> and synths the record", () => {
    const { stack, zone } = testScope();
    const distribution = new Distribution(stack, "Dist", {
      defaultBehavior: { origin: new HttpOrigin("origin.example.net") },
    });

    const target = cloudfrontAliasTarget(ref("dist", (r: { dist: Distribution }) => r.dist));
    expect(isRef(target)).toBe(true);

    createARecordBuilder()
      .zone(zone)
      .target(target)
      .build(stack, "ApexAlias", { dist: { dist: distribution } });

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      AliasTarget: Match.objectLike({
        DNSName: Match.objectLike({ "Fn::GetAtt": Match.arrayWith(["DomainName"]) }),
      }),
    });
  });
});

describe("apiGatewayAliasTarget", () => {
  it("synthesises an alias record for a concrete RestApiBase", () => {
    const { stack, zone } = testScope();
    const api = new RestApi(stack, "Api", {
      domainName: {
        domainName: "api.example.com",
        certificate: new Certificate(stack, "Cert", { domainName: "api.example.com" }),
        endpointType: EndpointType.REGIONAL,
      },
    });
    api.root.addMethod(
      "GET",
      new LambdaIntegration(
        new LambdaFn(stack, `Handler${stack.node.children.length}`, {
          runtime: Runtime.NODEJS_20_X,
          handler: "index.handler",
          code: Code.fromInline("exports.handler = async () => ({});"),
        }),
      ),
    );

    createARecordBuilder().zone(zone).target(apiGatewayAliasTarget(api)).build(stack, "ApiAlias");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      AliasTarget: Match.objectLike({ DNSName: Match.anyValue() }),
    });
  });

  it("returns a Ref-based target for a Ref<RestApiBase> and synths the record", () => {
    const { stack, zone } = testScope();
    const api = new RestApi(stack, "Api", {
      domainName: {
        domainName: "api.example.com",
        certificate: new Certificate(stack, "Cert", { domainName: "api.example.com" }),
        endpointType: EndpointType.REGIONAL,
      },
    });
    api.root.addMethod(
      "GET",
      new LambdaIntegration(
        new LambdaFn(stack, `Handler${stack.node.children.length}`, {
          runtime: Runtime.NODEJS_20_X,
          handler: "index.handler",
          code: Code.fromInline("exports.handler = async () => ({});"),
        }),
      ),
    );

    const target = apiGatewayAliasTarget(ref("api", (r: { api: RestApi }) => r.api));
    expect(isRef(target)).toBe(true);

    createARecordBuilder().zone(zone).target(target).build(stack, "ApiAlias", { api: { api } });

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      AliasTarget: Match.objectLike({ DNSName: Match.anyValue() }),
    });
  });
});

describe("apiGatewayDomainAliasTarget", () => {
  it("synthesises an alias record for a concrete DomainName", () => {
    const { stack, zone } = testScope();
    const domain = new DomainName(stack, "Domain", {
      domainName: "shared.example.com",
      certificate: new Certificate(stack, "Cert", { domainName: "shared.example.com" }),
      endpointType: EndpointType.REGIONAL,
    });

    createARecordBuilder()
      .zone(zone)
      .target(apiGatewayDomainAliasTarget(domain))
      .build(stack, "DomainAlias");

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      AliasTarget: Match.objectLike({ DNSName: Match.anyValue() }),
    });
  });

  it("returns a Ref-based target for a Ref<IDomainName> and synths the record", () => {
    const { stack, zone } = testScope();
    const domain = new DomainName(stack, "Domain", {
      domainName: "shared.example.com",
      certificate: new Certificate(stack, "Cert", { domainName: "shared.example.com" }),
      endpointType: EndpointType.REGIONAL,
    });

    const target = apiGatewayDomainAliasTarget(
      ref("domain", (r: { domain: DomainName }) => r.domain),
    );
    expect(isRef(target)).toBe(true);

    createARecordBuilder()
      .zone(zone)
      .target(target)
      .build(stack, "DomainAlias", { domain: { domain } });

    Template.fromStack(stack).hasResourceProperties("AWS::Route53::RecordSet", {
      Type: "A",
      AliasTarget: Match.objectLike({ DNSName: Match.anyValue() }),
    });
  });
});
