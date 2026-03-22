import type { Context } from "tentacular";
import type { StoreResult, StoredFile } from "./store-originals.ts";

export interface ExtractedDocument {
  fileId: string;
  fileName: string;
  fullText: string;
  pageCount: number;
  rustfsPath: string;
}

export interface ExtractResult {
  documents: ExtractedDocument[];
}

/** Extract readable text from PDF/DOCX contract files */
export default async function run(ctx: Context, input: unknown): Promise<ExtractResult> {
  const { files } = input as StoreResult;

  if (files.length === 0) {
    ctx.log.info("No files to extract text from");
    return { documents: [] };
  }

  ctx.log.info(`Extracting text from ${files.length} file(s)`);

  const documents: ExtractedDocument[] = [];

  for (const file of files) {
    try {
      const binaryStr = atob(file.content);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) {
        bytes[i] = binaryStr.charCodeAt(i);
      }

      let fullText = "";
      let pageCount = 1;

      if (file.mimeType === "application/pdf") {
        // Extract text from PDF -- basic text extraction from PDF stream objects
        const pdfContent = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
        fullText = extractPdfText(pdfContent);
        // Estimate page count from PDF page markers
        const pageMatches = pdfContent.match(/\/Type\s*\/Page[^s]/g);
        pageCount = pageMatches ? pageMatches.length : 1;
      } else {
        // DOCX: extract text from the XML structure
        fullText = extractDocxText(bytes);
        // Estimate pages from content length (~3000 chars per page)
        pageCount = Math.max(1, Math.ceil(fullText.length / 3000));
      }

      documents.push({
        fileId: file.fileId,
        fileName: file.fileName,
        fullText: fullText.trim(),
        pageCount,
        rustfsPath: file.rustfsPath,
      });

      ctx.log.info(`Extracted ${fullText.length} chars from ${file.fileName} (~${pageCount} pages)`);
    } catch (err) {
      ctx.log.warn(`Error extracting text from ${file.fileName}: ${err instanceof Error ? err.message : String(err)}`);
      documents.push({
        fileId: file.fileId,
        fileName: file.fileName,
        fullText: "",
        pageCount: 0,
        rustfsPath: file.rustfsPath,
      });
    }
  }

  ctx.log.info(`Extracted text from ${documents.length} document(s)`);
  return { documents };
}

/** Extract text content from PDF stream objects */
function extractPdfText(pdfContent: string): string {
  const textParts: string[] = [];

  // Match text between BT (Begin Text) and ET (End Text) operators
  const btEtRegex = /BT\s([\s\S]*?)ET/g;
  let match: RegExpExecArray | null;
  while ((match = btEtRegex.exec(pdfContent)) !== null) {
    const block = match[1];
    // Extract text from Tj and TJ operators
    const tjRegex = /\(([^)]*)\)\s*Tj/g;
    let tjMatch: RegExpExecArray | null;
    while ((tjMatch = tjRegex.exec(block)) !== null) {
      textParts.push(tjMatch[1]);
    }
  }

  // Also try to extract text from stream objects
  const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
  while ((match = streamRegex.exec(pdfContent)) !== null) {
    const content = match[1];
    // Only include if it looks like readable text
    if (/^[\x20-\x7E\r\n\t]{20,}/.test(content)) {
      textParts.push(content);
    }
  }

  return textParts.join("\n").replace(/\s+/g, " ").trim();
}

/** Extract text content from DOCX XML structure */
function extractDocxText(bytes: Uint8Array): string {
  // DOCX is a ZIP file -- look for document.xml content
  const content = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  // Try to find XML text content between <w:t> tags
  const textParts: string[] = [];
  const wtRegex = /<w:t[^>]*>([^<]*)<\/w:t>/g;
  let match: RegExpExecArray | null;
  while ((match = wtRegex.exec(content)) !== null) {
    textParts.push(match[1]);
  }

  if (textParts.length > 0) {
    return textParts.join(" ");
  }

  // Fallback: strip all XML tags and return printable text
  const stripped = content
    .replace(/<[^>]+>/g, " ")
    .replace(/[^\x20-\x7E\n]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  return stripped;
}
