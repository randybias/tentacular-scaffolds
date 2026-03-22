import type { Context } from "tentacular";

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

interface Chunk {
  chunkIndex: number;
  text: string;
  startChar: number;
  endChar: number;
}

interface FileChunks {
  fileId: string;
  fileName: string;
  chunks: Chunk[];
}

interface ChunkResult {
  fileChunks: FileChunks[];
  totalChunks: number;
}

/** Rough token count estimation (4 chars per token average) */
function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Find the character position that corresponds to approximately N tokens */
function tokenBoundary(text: string, tokenCount: number): number {
  return Math.min(tokenCount * 4, text.length);
}

/** Extract plain text from base64-encoded content based on MIME type */
function extractText(content: string, mimeType: string, fileName: string): string {
  const bytes = Uint8Array.from(atob(content), (c) => c.charCodeAt(0));
  const decoder = new TextDecoder("utf-8", { fatal: false });

  // For text-based formats, decode directly
  if (
    mimeType.startsWith("text/") ||
    mimeType === "application/json" ||
    mimeType === "application/xml"
  ) {
    return decoder.decode(bytes);
  }

  // For Markdown files detected by extension
  if (fileName.endsWith(".md") || fileName.endsWith(".markdown")) {
    return decoder.decode(bytes);
  }

  // For PDF: extract text between stream markers (basic extraction)
  if (mimeType === "application/pdf") {
    const raw = decoder.decode(bytes);
    const textParts: string[] = [];
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    while ((match = streamRegex.exec(raw)) !== null) {
      const streamContent = match[1];
      // Extract printable ASCII runs from stream data
      const printable = streamContent.replace(/[^\x20-\x7E\n\r\t]/g, " ");
      const cleaned = printable.replace(/\s+/g, " ").trim();
      if (cleaned.length > 20) {
        textParts.push(cleaned);
      }
    }
    if (textParts.length > 0) {
      return textParts.join("\n\n");
    }
    // Fallback: extract all printable text
    return raw.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
  }

  // For DOCX: extract text from XML content within the zip
  if (
    mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    fileName.endsWith(".docx")
  ) {
    const raw = decoder.decode(bytes);
    // Extract text between XML tags (simplified DOCX extraction)
    const textContent = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
    return textContent;
  }

  // Fallback: try to decode as text
  const text = decoder.decode(bytes);
  return text.replace(/[^\x20-\x7E\n\r\t]/g, " ").replace(/\s+/g, " ").trim();
}

/** Split text into overlapping chunks of ~500 tokens with 50 token overlap */
function chunkText(text: string, chunkTokens: number, overlapTokens: number): Chunk[] {
  const chunks: Chunk[] = [];
  const textLength = text.length;
  const totalTokens = estimateTokens(text);

  if (totalTokens <= chunkTokens) {
    chunks.push({
      chunkIndex: 0,
      text,
      startChar: 0,
      endChar: textLength,
    });
    return chunks;
  }

  let startChar = 0;
  let chunkIndex = 0;

  while (startChar < textLength) {
    const endChar = Math.min(startChar + tokenBoundary(text.slice(startChar), chunkTokens), textLength);
    const chunkText = text.slice(startChar, endChar);

    chunks.push({
      chunkIndex,
      text: chunkText,
      startChar,
      endChar,
    });

    // Move forward by (chunkTokens - overlapTokens) worth of characters
    const advance = tokenBoundary(text.slice(startChar), chunkTokens - overlapTokens);
    startChar += advance;
    chunkIndex++;

    // Safety check to prevent infinite loops
    if (advance === 0) break;
  }

  return chunks;
}

/** Extract text from various document formats and split into overlapping chunks */
export default async function run(ctx: Context, input: unknown): Promise<ChunkResult> {
  const data = input as StoreResult;

  if (data.storedFiles.length === 0) {
    ctx.log.info("No files to extract and chunk");
    return { fileChunks: [], totalChunks: 0 };
  }

  const fileChunks: FileChunks[] = [];
  let totalChunks = 0;

  for (const file of data.storedFiles) {
    try {
      const text = extractText(file.content, file.mimeType, file.fileName);

      if (text.length === 0) {
        ctx.log.warn(`No text extracted from ${file.fileName}`);
        continue;
      }

      ctx.log.info(`Extracted ${text.length} chars (~${estimateTokens(text)} tokens) from ${file.fileName}`);

      const chunks = chunkText(text, 500, 50);
      fileChunks.push({
        fileId: file.fileId,
        fileName: file.fileName,
        chunks,
      });
      totalChunks += chunks.length;

      ctx.log.info(`Split ${file.fileName} into ${chunks.length} chunks`);
    } catch (err) {
      ctx.log.error(`Failed to process ${file.fileName}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  ctx.log.info(`Extracted and chunked ${data.storedFiles.length} file(s) into ${totalChunks} total chunks`);
  return { fileChunks, totalChunks };
}
