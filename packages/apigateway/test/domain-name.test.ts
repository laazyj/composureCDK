import { describe, it, expect } from "vitest";
import {
  ApiDefinition,
  MockIntegration,
  type RestApiBase,
  SecurityPolicy,
} from "aws-cdk-lib/aws-apigateway";
import { Certificate, type ICertificate } from "aws-cdk-lib/aws-certificatemanager";
import { type Stack } from "aws-cdk-lib";
import { type IConstruct } from "constructs";
import { buildFixture } from "@composurecdk/cdk-testing";
import { ref } from "@composurecdk/core";
import type { RestApiBuilderPropsBase } from "../src/builder-common.js";
import { createRestApiBuilder } from "../src/rest-api-builder.js";
import { createSpecRestApiBuilder } from "../src/spec-rest-api-builder.js";

const DOMAIN = "api.example.com";
const CERT_ARN = "arn:aws:acm:us-east-1:123456789012:certificate/abc-123";

function certificate(stack: Stack): ICertificate {
  return Certificate.fromCertificateArn(stack, "Cert", CERT_ARN);
}

/** The surface both REST API builders share that these tests drive. */
interface DomainBuilder {
  domainName(options: RestApiBuilderPropsBase["domainName"]): DomainBuilder;
  build(scope: IConstruct, id: string, context?: Record<string, object>): { api: RestApiBase };
}

const seeded: Record<string, () => DomainBuilder> = {
  RestApiBuilder: () => createRestApiBuilder().addMethod("GET", new MockIntegration()),
  SpecRestApiBuilder: () =>
    createSpecRestApiBuilder().apiDefinition(
      ApiDefinition.fromInline({
        openapi: "3.0.2",
        info: { title: "TestApi", version: "1.0" },
        paths: {},
      }),
    ),
};

describe.each(Object.entries(seeded))("%s domainName", (_, factory) => {
  const buildAndSynth = buildFixture(factory, "TestApi");

  it("creates no domain name by default", () => {
    const { result, template } = buildAndSynth();

    template.resourceCountIs("AWS::ApiGateway::DomainName", 0);
    expect(result.api.domainName).toBeUndefined();
  });

  it("creates a TLS 1.2 domain with a concrete certificate, mapped to the API root", () => {
    const { result, template } = buildAndSynth((b, stack) =>
      b.domainName({ domainName: DOMAIN, certificate: certificate(stack) }),
    );

    template.hasResourceProperties("AWS::ApiGateway::DomainName", {
      DomainName: DOMAIN,
      RegionalCertificateArn: CERT_ARN,
      EndpointConfiguration: { Types: ["REGIONAL"] },
      SecurityPolicy: "TLS_1_2",
    });
    template.resourceCountIs("AWS::ApiGateway::BasePathMapping", 1);
    expect(result.api.domainName).toBeDefined();
  });

  it("lets the user override the security policy", () => {
    const { template } = buildAndSynth((b, stack) =>
      b.domainName({
        domainName: DOMAIN,
        certificate: certificate(stack),
        securityPolicy: SecurityPolicy.TLS_1_0,
      }),
    );

    template.hasResourceProperties("AWS::ApiGateway::DomainName", {
      SecurityPolicy: "TLS_1_0",
    });
  });

  it("resolves a certificate ref against the build context", () => {
    // Filled in once the stack exists; read when the builder resolves the ref.
    const dns: { certificate?: ICertificate } = {};
    const { template } = buildAndSynth(
      (b, stack) => {
        dns.certificate = certificate(stack);
        b.domainName({
          domainName: DOMAIN,
          certificate: ref("dns", (r: { certificate?: ICertificate }) => {
            if (r.certificate === undefined) throw new Error("no certificate");
            return r.certificate;
          }),
        });
      },
      { context: { dns } },
    );

    template.hasResourceProperties("AWS::ApiGateway::DomainName", {
      DomainName: DOMAIN,
      RegionalCertificateArn: CERT_ARN,
    });
  });

  it("throws when the certificate ref's component is missing from the context", () => {
    expect(() =>
      buildAndSynth((b) =>
        b.domainName({
          domainName: DOMAIN,
          certificate: ref("dns", (r: { certificate: ICertificate }) => r.certificate),
        }),
      ),
    ).toThrow(/dns/);
  });
});
