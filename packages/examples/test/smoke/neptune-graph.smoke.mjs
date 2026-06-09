import { findStackResources, pollUntil } from "./_helpers.mjs";

const STACK = "ComposureCDK-NeptuneGraphStack";

/**
 * Post-deploy functional check for the Neptune graph example.
 *
 * Proves the cluster is alive and *accessible from within the application*,
 * not merely defined: it uses SSM `SendCommand` to run a script on the
 * bastion that issues a SigV4-signed OpenCypher health query
 * (`RETURN 1 AS health`) against the IAM-authenticated cluster endpoint. A
 * passing result exercises the whole path the example wires up — SSM
 * reachability via the interface endpoints, the bastion's closed-egress SG,
 * the `allowAccessFrom` network + IAM grant, and the running graph engine.
 *
 * The signing is done with the Python standard library (no awscurl/boto3),
 * since the bastion sits in an isolated VPC with no internet egress.
 */

// Standalone Python SigV4 client (stdlib only). Reads instance-role creds
// from IMDSv2, signs a POST to the cluster's OpenCypher endpoint, and prints
// the engine's response. argv: <host> <port>.
const HEALTH_SCRIPT = String.raw`
import sys, json, hashlib, hmac, datetime, urllib.request, urllib.parse

def imds_token():
    req = urllib.request.Request(
        "http://169.254.169.254/latest/api/token", method="PUT",
        headers={"X-aws-ec2-metadata-token-ttl-seconds": "21600"})
    return urllib.request.urlopen(req, timeout=5).read().decode()

def imds(path, token):
    req = urllib.request.Request(
        "http://169.254.169.254/latest/meta-data/" + path,
        headers={"X-aws-ec2-metadata-token": token})
    return urllib.request.urlopen(req, timeout=5).read().decode()

def _hmac(key, msg):
    return hmac.new(key, msg.encode(), hashlib.sha256).digest()

host, port = sys.argv[1], sys.argv[2]
service = "neptune-db"

token = imds_token()
region = imds("placement/region", token)
role = imds("iam/security-credentials/", token).splitlines()[0]
creds = json.loads(imds("iam/security-credentials/" + role, token))
ak, sk, st = creds["AccessKeyId"], creds["SecretAccessKey"], creds["Token"]

body = "query=" + urllib.parse.quote("RETURN 1 AS health")
now = datetime.datetime.now(datetime.timezone.utc)
amzdate = now.strftime("%Y%m%dT%H%M%SZ")
datestamp = now.strftime("%Y%m%d")
payload_hash = hashlib.sha256(body.encode()).hexdigest()

canonical_headers = (
    "content-type:application/x-www-form-urlencoded\n"
    "host:" + host + ":" + port + "\n"
    "x-amz-date:" + amzdate + "\n"
    "x-amz-security-token:" + st + "\n")
signed_headers = "content-type;host;x-amz-date;x-amz-security-token"
canonical_request = "\n".join(
    ["POST", "/openCypher", "", canonical_headers, signed_headers, payload_hash])

scope = datestamp + "/" + region + "/" + service + "/aws4_request"
string_to_sign = "\n".join(
    ["AWS4-HMAC-SHA256", amzdate, scope,
     hashlib.sha256(canonical_request.encode()).hexdigest()])

k = _hmac(("AWS4" + sk).encode(), datestamp)
k = _hmac(k, region)
k = _hmac(k, service)
k = _hmac(k, "aws4_request")
signature = hmac.new(k, string_to_sign.encode(), hashlib.sha256).hexdigest()

authorization = (
    "AWS4-HMAC-SHA256 Credential=" + ak + "/" + scope +
    ", SignedHeaders=" + signed_headers + ", Signature=" + signature)

req = urllib.request.Request(
    "https://" + host + ":" + port + "/openCypher", data=body.encode(), method="POST",
    headers={"Content-Type": "application/x-www-form-urlencoded",
             "X-Amz-Date": amzdate, "X-Amz-Security-Token": st,
             "Authorization": authorization})
resp = urllib.request.urlopen(req, timeout=15)
out = resp.read().decode()
print("HTTP", resp.status, out)
sys.exit(0 if (resp.status == 200 and '"health"' in out) else 1)
`;

const TERMINAL = new Set(["Success", "Failed", "Cancelled", "TimedOut"]);

export default {
  name: "Neptune OpenCypher health query via bastion",
  run: async ({ aws, pass, fail }) => {
    const clusterResources = findStackResources(aws, STACK, { type: "AWS::Neptune::DBCluster" });
    if (clusterResources.length === 0) {
      fail(`${STACK} — no AWS::Neptune::DBCluster resources found`);
      return;
    }
    const { DBClusters: clusters } = aws(
      "neptune",
      "describe-db-clusters",
      "--db-cluster-identifier",
      clusterResources[0].PhysicalResourceId,
      "--output",
      "json",
    );
    const cluster = clusters?.[0];
    if (!cluster) {
      fail(`${STACK} — describe-db-clusters returned no cluster`);
      return;
    }
    if (cluster.Status !== "available") {
      fail(`${STACK} — cluster status=${cluster.Status} (expected available)`);
      return;
    }

    const instances = findStackResources(aws, STACK, { type: "AWS::EC2::Instance" });
    if (instances.length === 0) {
      fail(`${STACK} — no bastion EC2 instance found`);
      return;
    }
    const instanceId = instances[0].PhysicalResourceId;

    const script = `cat > /tmp/neptune_health.py <<'PYEOF'\n${HEALTH_SCRIPT}\nPYEOF\npython3 /tmp/neptune_health.py '${cluster.Endpoint}' '${String(cluster.Port)}'`;

    const { Command } = aws(
      "ssm",
      "send-command",
      "--instance-ids",
      instanceId,
      "--document-name",
      "AWS-RunShellScript",
      "--parameters",
      JSON.stringify({ commands: [script] }),
      "--output",
      "json",
    );
    const commandId = Command?.CommandId;
    if (!commandId) {
      fail(`${STACK} — ssm send-command returned no CommandId`);
      return;
    }

    let invocation;
    const completed = await pollUntil(
      () => {
        try {
          invocation = aws(
            "ssm",
            "get-command-invocation",
            "--command-id",
            commandId,
            "--instance-id",
            instanceId,
            "--output",
            "json",
          );
          return TERMINAL.has(invocation.Status);
        } catch {
          // InvocationDoesNotExist briefly after send — keep polling.
          return false;
        }
      },
      { timeoutMs: 120_000, intervalMs: 5_000 },
    );

    if (!completed) {
      fail(`${STACK} — SSM command did not complete within timeout`);
      return;
    }
    if (invocation.Status === "Success") {
      pass(
        `${STACK} — OpenCypher health query succeeded: ${(invocation.StandardOutputContent ?? "").trim()}`,
      );
    } else {
      fail(
        `${STACK} — OpenCypher health query ${invocation.Status}: ${(invocation.StandardErrorContent || invocation.StandardOutputContent || "").trim()}`,
      );
    }
  },
};
