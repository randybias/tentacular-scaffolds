import type { Context } from "tentacular";
import type { PollResult, DriveFile } from "./poll-drive.ts";

export interface StoredFile {
  fileId: string;
  fileName: string;
  mimeType: string;
  content: string; // base64 passed through
  rustfsPath: string;
}

export interface StoreResult {
  files: StoredFile[];
  storedCount: number;
}

/** Store original contract files in RustFS under contracts/{date}/{fileId}/{fileName} */
export default async function run(ctx: Context, input: unknown): Promise<StoreResult> {
  const { files } = input as PollResult;

  if (files.length === 0) {
    ctx.log.info("No files to store");
    return { files: [], storedCount: 0 };
  }

  const rustfs = ctx.dependency("tentacular-rustfs");
  const datePath = new Date().toISOString().substring(0, 10);
  const storedFiles: StoredFile[] = [];
  let storedCount = 0;

  for (const file of files) {
    const key = `contracts/${datePath}/${file.fileId}/${file.fileName}`;

    if (rustfs.secret) {
      try {
        // Decode base64 to binary for upload
        const binaryStr = atob(file.content);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
          bytes[i] = binaryStr.charCodeAt(i);
        }

        const mimeType = file.mimeType === "application/pdf"
          ? "application/pdf"
          : "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

        const putRes = await rustfs.fetch!(`/contracts/${key}`, {
          method: "PUT",
          headers: {
            "Content-Type": mimeType,
            "Authorization": `Bearer ${rustfs.secret}`,
          },
          body: bytes,
        });

        if (putRes.ok) {
          storedCount++;
          ctx.log.info(`Stored ${file.fileName} in RustFS: ${key}`);
        } else {
          ctx.log.warn(`RustFS upload failed for ${file.fileName}: ${putRes.status}`);
        }
      } catch (err) {
        ctx.log.warn(`Error storing ${file.fileName}: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      ctx.log.warn("No rustfs credentials, skipping S3 storage");
    }

    // Pass through file data with rustfs path
    storedFiles.push({
      fileId: file.fileId,
      fileName: file.fileName,
      mimeType: file.mimeType,
      content: file.content,
      rustfsPath: key,
    });
  }

  ctx.log.info(`Stored ${storedCount}/${files.length} files in RustFS`);
  return { files: storedFiles, storedCount };
}
