import type { Context } from "tentacular";
import { S3Client } from "https://deno.land/x/s3_lite_client@0.7.0/mod.ts";

interface DriveFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  content: string;
  modifiedAt: string;
}

interface PollResult {
  files: DriveFile[];
  pollTimestamp: string;
}

interface StoredFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  s3Path: string;
  content: string;
  modifiedAt: string;
}

interface StoreResult {
  storedFiles: StoredFile[];
  pollTimestamp: string;
}

/** Store original documents in RustFS under kb/{fileId}/{fileName} */
export default async function run(ctx: Context, input: unknown): Promise<StoreResult> {
  const data = input as PollResult;

  // Access dependency early for contract drift detection
  const rustfs = ctx.dependency("rustfs");

  if (data.files.length === 0) {
    ctx.log.info("No files to store");
    return { storedFiles: [], pollTimestamp: data.pollTimestamp };
  }
  if (!rustfs.secret) {
    ctx.log.warn("No RustFS credentials, passing files through without storage");
    return {
      storedFiles: data.files.map((f) => ({
        fileId: f.fileId,
        fileName: f.fileName,
        mimeType: f.mimeType,
        s3Path: "",
        content: f.content,
        modifiedAt: f.modifiedAt,
      })),
      pollTimestamp: data.pollTimestamp,
    };
  }

  const s3 = new S3Client({
    endPoint: rustfs.host,
    port: rustfs.port,
    useSSL: true,
    accessKey: rustfs.secret,
    secretKey: (rustfs as Record<string, unknown>).secretKey as string ?? "",
    bucket: (rustfs as Record<string, unknown>).bucket as string ?? "tentacular",
    pathStyle: true,
  });

  const storedFiles: StoredFile[] = [];

  for (const file of data.files) {
    const s3Path = `kb/${file.fileId}/${file.fileName}`;
    const bytes = Uint8Array.from(atob(file.content), (c) => c.charCodeAt(0));

    try {
      await s3.putObject(s3Path, bytes, {
        metadata: {
          "Content-Type": file.mimeType,
          "x-amz-meta-file-id": file.fileId,
        },
      });

      ctx.log.info(`Stored ${file.fileName} at ${s3Path}`);
      storedFiles.push({
        fileId: file.fileId,
        fileName: file.fileName,
        mimeType: file.mimeType,
        s3Path,
        content: file.content,
        modifiedAt: file.modifiedAt,
      });
    } catch (err) {
      ctx.log.error(`Failed to store ${file.fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Stored ${storedFiles.length}/${data.files.length} file(s) in RustFS`);
  return { storedFiles, pollTimestamp: data.pollTimestamp };
}
