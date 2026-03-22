import type { Context } from "tentacular";

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

interface EmbeddedChunk {
  chunkIndex: number;
  text: string;
  vector: number[];
}

interface FileEmbeddings {
  fileId: string;
  fileName: string;
  embeddings: EmbeddedChunk[];
}

interface EmbeddingsResult {
  fileEmbeddings: FileEmbeddings[];
  totalEmbeddings: number;
  dimensions: number;
}

/** Call OpenAI embeddings API for a batch of texts */
async function getEmbeddings(
  ctx: Context,
  texts: string[],
): Promise<number[][]> {
  const openai = ctx.dependency("openai");
  if (!openai.secret) {
    throw new Error("No openai.api_key in secrets");
  }

  const res = await openai.fetch!("/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "text-embedding-ada-002",
      input: texts,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings API failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.data.map((item: { embedding: number[] }) => item.embedding);
}

/** Generate embeddings for all chunks using OpenAI text-embedding-ada-002 */
export default async function run(ctx: Context, input: unknown): Promise<EmbeddingsResult> {
  const data = input as ChunkResult;

  // Access dependency early for contract drift detection
  const openai = ctx.dependency("openai");

  if (data.fileChunks.length === 0) {
    ctx.log.info("No chunks to generate embeddings for");
    return { fileEmbeddings: [], totalEmbeddings: 0, dimensions: 1536 };
  }

  if (!openai.secret) {
    ctx.log.warn("No openai.api_key in secrets -- returning empty embeddings (test mode)");
    return { fileEmbeddings: [], totalEmbeddings: 0, dimensions: 1536 };
  }

  const fileEmbeddings: FileEmbeddings[] = [];
  let totalEmbeddings = 0;
  const batchSize = 20;

  for (const fileChunk of data.fileChunks) {
    const embeddings: EmbeddedChunk[] = [];

    // Process chunks in batches to respect API limits
    for (let i = 0; i < fileChunk.chunks.length; i += batchSize) {
      const batch = fileChunk.chunks.slice(i, i + batchSize);
      const texts = batch.map((c) => c.text);

      try {
        ctx.log.info(
          `Generating embeddings for ${fileChunk.fileName} batch ${Math.floor(i / batchSize) + 1} (${texts.length} chunks)`,
        );

        const vectors = await getEmbeddings(ctx, texts);

        for (let j = 0; j < batch.length; j++) {
          embeddings.push({
            chunkIndex: batch[j].chunkIndex,
            text: batch[j].text,
            vector: vectors[j],
          });
        }
      } catch (err) {
        ctx.log.error(
          `Failed to generate embeddings for ${fileChunk.fileName} batch ${Math.floor(i / batchSize) + 1}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    fileEmbeddings.push({
      fileId: fileChunk.fileId,
      fileName: fileChunk.fileName,
      embeddings,
    });
    totalEmbeddings += embeddings.length;
    ctx.log.info(`Generated ${embeddings.length} embeddings for ${fileChunk.fileName}`);
  }

  ctx.log.info(`Generated ${totalEmbeddings} total embeddings across ${fileEmbeddings.length} file(s)`);
  return { fileEmbeddings, totalEmbeddings, dimensions: 1536 };
}
