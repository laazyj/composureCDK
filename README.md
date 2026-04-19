# ComposureCDK

**Composable, lifecycle-managed AWS infrastructure.**

ComposureCDK is a TypeScript library built on [AWS CDK](https://docs.aws.amazon.com/cdk/) that brings managed lifecycles, explicit dependency graphs, and builder patterns to cloud infrastructure definition. It is inspired by Stuart Sierra's [Component](https://github.com/stuartsierra/component) library for Clojure.

## The Problem

AWS CDK provides powerful L2 constructs for defining cloud infrastructure, but as applications grow, teams encounter recurring friction:

- **Integration complexity** — Wiring CDK constructs together (IAM roles, security groups, event sources, permissions) requires repetitive boilerplate that obscures the actual architecture. The relationships between components are implicit in procedural code rather than declared as data.

- **Missing best practices** — CDK's L2 constructs reflect AWS defaults, not AWS best practices. Encryption at rest, access logging, least-privilege IAM, versioning, lifecycle policies — these must be manually applied to every resource. Teams either build internal wrapper constructs or accept the drift.

- **Unclear structure** — Without conventions, CDK applications become tangled graphs of constructs with no clear dependency order, no consistent patterns, and no boundary between infrastructure concerns. Testing and reasoning about the system becomes difficult.

## Goals

ComposureCDK addresses these problems through three complementary ideas:

### 1. Managed Lifecycles and Dependency Resolution

Components declare their dependencies explicitly. The system resolves the dependency graph and assembles components in the correct order — no manual wiring, no implicit coupling. If component A needs component B, that relationship is declared, not buried in constructor logic.

This is directly inspired by Stuart Sierra's Component: dependencies are data, not code.

### 2. Secure and Operational Defaults

Every ComposureCDK component applies AWS-recommended best practices out of the box. S3 buckets encrypt at rest, block public access, and enable versioning. Lambda functions use least-privilege execution roles. ECS services configure health checks and logging.

These defaults are not locked. They are the starting point. Application developers can override any default when their use case requires it. The goal is that doing nothing produces a secure, well-configured resource — and deviations are intentional and visible.

### 3. Builder Patterns for Clarity

Components are defined using builder patterns that read as declarations of intent rather than sequences of mutations. This reduces the surface area of each component's API, makes configuration discoverable, and keeps infrastructure code concise.

## Philosophy

### Explicit over implicit

Dependencies between components are declared, not inferred. Configuration choices are visible in code, not hidden in defaults or conventions. When a component needs something, it says so.

### Defaults should be correct

The right thing to do should also be the easiest thing to do. If AWS recommends encrypting a bucket, encryption should be on by default. If a security group should not allow unrestricted ingress, it should not. The developer's job is to describe their system — not to remember a checklist of operational hygiene.

### Less code, more architecture

Infrastructure code should express _what the system is_, not _how to assemble it_. By managing lifecycles and dependencies automatically, ComposureCDK removes the procedural glue that dominates most CDK applications. What remains is a clear description of components and their relationships.

### Composability over inheritance

Components are composed together to form systems. They do not inherit from deep class hierarchies. A system is a flat map of named components with declared dependencies — easy to understand, easy to test, easy to change.

### No cyclic dependencies

If two components depend on each other, that is an architectural problem to be solved by restructuring — not a runtime problem to be worked around. ComposureCDK treats cycles as errors.

## Who Is This For?

- **Application engineers** building services on AWS who want to spend less time on infrastructure plumbing and more time on their application. ComposureCDK provides well-configured building blocks that compose cleanly.

- **Infrastructure engineers** who want to standardise patterns, enforce best practices, and reduce configuration drift across an organisation. ComposureCDK's defaults and builder patterns provide a consistent foundation that teams can extend.

## Packages

| Package                    | Description                                                 |
| -------------------------- | ----------------------------------------------------------- |
| `@composurecdk/core`       | System lifecycle, dependency resolution, component protocol |
| `@composurecdk/s3`         | S3 bucket components with secure defaults                   |
| `@composurecdk/lambda`     | Lambda function components                                  |
| `@composurecdk/ecs`        | ECS service and task components                             |
| `@composurecdk/iam`        | IAM role and policy components                              |
| `@composurecdk/apigateway` | API Gateway components                                      |
| `@composurecdk/ec2`        | EC2 and VPC components                                      |
| `@composurecdk/acm`        | ACM certificate components with DNS validation              |
| `@composurecdk/route53`    | Route 53 hosted zones, records, and alias target helpers    |

## License

[MIT](LICENSE)
