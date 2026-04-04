/**
 * Minimal AWS Signature V4 S3 client for Deno.
 * Uses only crypto.subtle (built-in) — no external dependencies.
 * Compatible with MinIO, RustFS, and any S3-compatible API.
 */

/** Compute SHA-256 hash of data, return hex string */
export async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Compute HMAC-SHA256, return raw bytes */
async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
  return new Uint8Array(sig);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Sign an S3 request with AWS Signature V4 */
async function signRequest(opts: {
  method: string;
  url: URL;
  headers: Headers;
  body: Uint8Array | undefined;
  accessKey: string;
  secretKey: string;
  region: string;
}): Promise<void> {
  const { method, url, headers, body, accessKey, secretKey, region } = opts;
  const service = "s3";
  const now = new Date();
  const dateStamp = now.toISOString().replace(/[-:]/g, "").slice(0, 8);
  const amzDate = dateStamp + "T" + now.toISOString().replace(/[-:]/g, "").slice(9, 15) + "Z";

  headers.set("x-amz-date", amzDate);
  headers.set("host", url.host);

  const payloadHash = await sha256Hex(body ?? new Uint8Array(0));
  headers.set("x-amz-content-sha256", payloadHash);

  // Canonical headers: include host, content-type (if set), and all x-amz-* headers
  const signedHeaderNames = [...headers.keys()]
    .filter((h) => h === "host" || h === "content-type" || h.startsWith("x-amz-"))
    .sort();
  const canonicalHeaders = signedHeaderNames
    .map((h) => `${h}:${headers.get(h)!.trim()}`)
    .join("\n") + "\n";
  const signedHeaders = signedHeaderNames.join(";");

  const canonicalRequest = [
    method,
    url.pathname,
    url.search ? url.search.slice(1) : "",
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    await sha256Hex(canonicalRequest),
  ].join("\n");

  const enc = new TextEncoder();
  const kDate = await hmacSha256(enc.encode("AWS4" + secretKey), dateStamp);
  const kRegion = await hmacSha256(kDate, region);
  const kService = await hmacSha256(kRegion, service);
  const kSigning = await hmacSha256(kService, "aws4_request");
  const signature = toHex(await hmacSha256(kSigning, stringToSign));

  headers.set(
    "Authorization",
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  );
}

export interface S3ClientConfig {
  endpoint: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  region: string;
}

/** Make a signed S3 request using path-style addressing */
export async function s3Fetch(
  config: S3ClientConfig,
  method: string,
  key: string,
  opts?: { body?: Uint8Array | string; contentType?: string },
): Promise<Response> {
  const url = new URL(`/${config.bucket}/${key}`, config.endpoint);
  const headers = new Headers();
  if (opts?.contentType) {
    headers.set("content-type", opts.contentType);
  }

  const body = opts?.body
    ? (typeof opts.body === "string" ? new TextEncoder().encode(opts.body) : opts.body)
    : undefined;

  await signRequest({
    method,
    url,
    headers,
    body,
    accessKey: config.accessKey,
    secretKey: config.secretKey,
    region: config.region,
  });

  return globalThis.fetch(url.toString(), { method, headers, body });
}

/** Parse S3 credentials from ctx.secrets["tentacular-rustfs"] */
export function parseS3Credentials(
  secrets: Record<string, Record<string, string>>,
  serviceName = "tentacular-rustfs",
): S3ClientConfig | null {
  const creds = secrets[serviceName];
  if (!creds?.access_key || !creds?.secret_key) return null;
  return {
    endpoint: creds.endpoint ?? "http://localhost:9000",
    bucket: creds.bucket ?? "tentacular",
    accessKey: creds.access_key,
    secretKey: creds.secret_key,
    region: creds.region ?? "us-east-1",
  };
}
