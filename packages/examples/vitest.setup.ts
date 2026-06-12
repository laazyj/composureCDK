import { expect } from "vitest";

// CDK addresses its bundled assets by content hash, and every such hash is a
// 64-char hex SHA-256. Two shapes show up in our synthesised example
// templates:
//
//   - `S3Key`            — the framework's custom-resource provider Lambdas
//                          (e.g. the VPC default-security-group cleanup
//                          handler) and the awscli Lambda layer that backs the
//                          static-website bucket deployment.
//   - `SourceObjectKeys` — the bucket-deployment source archive.
//
// These provider/layer/deployment hashes churn on every aws-cdk-lib release
// with no change to our own infrastructure, so they carry no signal in a
// snapshot — they only make routine dependency bumps fail the suite. We
// collapse every asset hash to a stable placeholder. These are the only
// 64-hex strings the templates contain, so a value-based serializer
// normalises both shapes without needing to inspect keys.
const ASSET_HASH = /^[0-9a-f]{64}(\.zip)?$/;

expect.addSnapshotSerializer({
  test: (value: unknown): boolean => typeof value === "string" && ASSET_HASH.test(value),
  serialize: (value: string) => (value.endsWith(".zip") ? '"<asset-hash>.zip"' : '"<asset-hash>"'),
});
