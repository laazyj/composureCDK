import { rule } from "../../src/rules/redeclared-prop-must-track-cdk-type.js";
import { ruleTester } from "../rule-tester.js";

ruleTester.run("redeclared-prop-must-track-cdk-type", rule, {
  valid: [
    {
      name: "reads the inner type from CDK's own prop",
      code: `
        import type { TopicProps } from "aws-cdk-lib/aws-sns";
        import type { Resolvable } from "@composurecdk/core";
        export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
          masterKey?: Resolvable<NonNullable<TopicProps["masterKey"]>>;
        }
      `,
    },
    {
      name: "reads an array element type from CDK's own prop",
      code: `
        import type { DatabaseClusterProps } from "@aws-cdk/aws-neptune-alpha";
        import type { Resolvable } from "@composurecdk/core";
        export interface ClusterBuilderProps extends Omit<DatabaseClusterProps, "securityGroups"> {
          securityGroups?: readonly Resolvable<
            NonNullable<DatabaseClusterProps["securityGroups"]>[number]
          >[];
        }
      `,
    },
    {
      name: "a primitive has nothing to track",
      code: `
        import type { NsRecordProps } from "aws-cdk-lib/aws-route53";
        import type { Resolvable } from "@composurecdk/core";
        export interface NsRecordBuilderProps extends Omit<NsRecordProps, "values"> {
          values?: Resolvable<string[]>;
        }
      `,
    },
    {
      name: "a union arm the builder adds is the author's judgement",
      code: `
        import type { CrossAccountZoneDelegationRecordProps } from "aws-cdk-lib/aws-route53";
        import type { Resolvable } from "@composurecdk/core";
        export interface DelegationBuilderProps
          extends Omit<CrossAccountZoneDelegationRecordProps, "delegationRole"> {
          delegationRole?: Resolvable<
            string | NonNullable<CrossAccountZoneDelegationRecordProps["delegationRole"]>
          >;
        }
      `,
    },
    {
      name: "a shape-replacing re-declaration keeps the builder's own type",
      code: `
        import type { BucketProps } from "aws-cdk-lib/aws-s3";
        export type ServerAccessLogsConfig = false | { prefix?: string };
        export interface BucketBuilderProps extends Omit<BucketProps, "serverAccessLogsBucket"> {
          serverAccessLogs?: ServerAccessLogsConfig;
        }
      `,
    },
    {
      name: "a prop the interface does not omit is not a re-declaration",
      code: `
        import type { IHostedZone } from "aws-cdk-lib/aws-route53";
        import type { CertificateProps } from "aws-cdk-lib/aws-certificatemanager";
        import type { Resolvable } from "@composurecdk/core";
        export interface CertificateBuilderProps extends CertificateProps {
          validationZone?: Resolvable<IHostedZone>;
        }
      `,
    },
    {
      name: "a type of the same name from another package is not CDK's",
      code: `
        import type { IKey } from "./local-keys.js";
        import type { TopicProps } from "aws-cdk-lib/aws-sns";
        import type { Resolvable } from "@composurecdk/core";
        export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
          masterKey?: Resolvable<IKey>;
        }
      `,
    },
  ],
  invalid: [
    {
      name: "pins a CDK interface inside Resolvable",
      code: `
        import type { IKey } from "aws-cdk-lib/aws-kms";
        import type { TopicProps } from "aws-cdk-lib/aws-sns";
        import type { Resolvable } from "@composurecdk/core";
        export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
          masterKey?: Resolvable<IKey>;
        }
      `,
      errors: [
        {
          messageId: "pinnedType",
          data: { prop: "masterKey", base: "TopicProps", pinned: "IKey" },
        },
      ],
    },
    {
      name: "pins a CDK interface reached through a namespace import",
      code: `
        import * as kms from "aws-cdk-lib/aws-kms";
        import type { TopicProps } from "aws-cdk-lib/aws-sns";
        import type { Resolvable } from "@composurecdk/core";
        export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
          masterKey?: Resolvable<kms.IKey>;
        }
      `,
      errors: [{ messageId: "pinnedType" }],
    },
    {
      name: "pins a CDK interface inside an array of Resolvables",
      code: `
        import type { ISecurityGroup, InterfaceVpcEndpointProps } from "aws-cdk-lib/aws-ec2";
        import type { Resolvable } from "@composurecdk/core";
        export interface EndpointBuilderProps
          extends Omit<InterfaceVpcEndpointProps, "securityGroups"> {
          securityGroups?: readonly Resolvable<ISecurityGroup>[];
        }
      `,
      errors: [{ messageId: "pinnedType" }],
    },
    {
      name: "a quoted property name is still a re-declaration",
      code: `
        import type { IKey } from "aws-cdk-lib/aws-kms";
        import type { TopicProps } from "aws-cdk-lib/aws-sns";
        import type { Resolvable } from "@composurecdk/core";
        export interface TopicBuilderProps extends Omit<TopicProps, "masterKey"> {
          "masterKey"?: Resolvable<IKey>;
        }
      `,
      errors: [{ messageId: "pinnedType" }],
    },
    {
      name: "flags each pinned prop of a multi-key Omit",
      code: `
        import type { IPrincipal, IManagedPolicy, RoleProps } from "aws-cdk-lib/aws-iam";
        import type { Resolvable } from "@composurecdk/core";
        export interface RoleBuilderProps
          extends Omit<RoleProps, "assumedBy" | "permissionsBoundary"> {
          assumedBy?: Resolvable<IPrincipal>;
          permissionsBoundary?: Resolvable<IManagedPolicy>;
        }
      `,
      errors: [{ messageId: "pinnedType" }, { messageId: "pinnedType" }],
    },
    {
      name: "pins a CDK interface from a versioned alpha module",
      code: `
        import type { DatabaseClusterProps } from "@aws-cdk/aws-neptune-alpha";
        import type { IKey } from "aws-cdk-lib/aws-kms";
        import type { Resolvable } from "@composurecdk/core";
        export interface ClusterBuilderProps extends Omit<DatabaseClusterProps, "kmsKey"> {
          kmsKey?: Resolvable<IKey>;
        }
      `,
      errors: [{ messageId: "pinnedType" }],
    },
  ],
});
