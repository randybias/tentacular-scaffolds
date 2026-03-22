import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";

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

interface StoreStats {
  filesProcessed: number;
  chunksInserted: number;
  chunksDeleted: number;
  errors: number;
}

const ENABLE_PGVECTOR = `CREATE EXTENSION IF NOT EXISTS vector;`;

const CREATE_TABLE = `
CREATE TABLE IF NOT EXISTS kb_chunks (
  id SERIAL PRIMARY KEY,
  file_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  chunk_index INT NOT NULL,
  text TEXT NOT NULL,
  embedding vector(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_file_id
  ON kb_chunks (file_id);

CREATE INDEX IF NOT EXISTS idx_kb_chunks_embedding
  ON kb_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);
`;

const DELETE_FILE_CHUNKS = `DELETE FROM kb_chunks WHERE file_id = $1;`;

const INSERT_CHUNK = `
INSERT INTO kb_chunks (file_id, file_name, chunk_index, text, embedding, created_at)
VALUES ($1, $2, $3, $4, $5, NOW())
RETURNING id;
`;

/** Store embeddings in pgvector table, replacing old chunks for updated files */
export default async function run(ctx: Context, input: unknown): Promise<StoreStats> {
  const data = input as EmbeddingsResult;

  // Access dependency early for contract drift detection
  const postgres = ctx.dependency("postgres");

  if (data.fileEmbeddings.length === 0) {
    ctx.log.info("No embeddings to store");
    return { filesProcessed: 0, chunksInserted: 0, chunksDeleted: 0, errors: 0 };
  }
  if (!postgres.secret) {
    ctx.log.warn("No postgres.password in secrets -- skipping storage");
    return { filesProcessed: 0, chunksInserted: 0, chunksDeleted: 0, errors: 0 };
  }

  ctx.log.info(`Connecting to Postgres at ${postgres.host}:${postgres.port}/${postgres.database}`);

  const client = new Client({
    hostname: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.secret,
    tls: { enabled: false },
  });

  let chunksInserted = 0;
  let chunksDeleted = 0;
  let errors = 0;

  try {
    await client.connect();

    // Enable pgvector extension and create table
    await client.queryArray(ENABLE_PGVECTOR);
    await client.queryArray(CREATE_TABLE);

    for (const fileEmb of data.fileEmbeddings) {
      try {
        // Delete existing chunks for this file (full replace on update)
        const deleteResult = await client.queryArray(DELETE_FILE_CHUNKS, [fileEmb.fileId]);
        const deleted = deleteResult.rowCount ?? 0;
        if (deleted > 0) {
          ctx.log.info(`Deleted ${deleted} old chunks for file ${fileEmb.fileId}`);
          chunksDeleted += deleted;
        }

        // Insert new chunks with embeddings
        for (const chunk of fileEmb.embeddings) {
          const vectorStr = `[${chunk.vector.join(",")}]`;
          await client.queryArray(INSERT_CHUNK, [
            fileEmb.fileId,
            fileEmb.fileName,
            chunk.chunkIndex,
            chunk.text,
            vectorStr,
          ]);
          chunksInserted++;
        }

        ctx.log.info(`Inserted ${fileEmb.embeddings.length} chunks for ${fileEmb.fileName}`);
      } catch (err) {
        ctx.log.error(
          `Failed to store chunks for ${fileEmb.fileName}: ${err instanceof Error ? err.message : String(err)}`,
        );
        errors++;
      }
    }
  } finally {
    await client.end();
  }

  const stats: StoreStats = {
    filesProcessed: data.fileEmbeddings.length,
    chunksInserted,
    chunksDeleted,
    errors,
  };

  ctx.log.info(
    `Storage complete: ${stats.filesProcessed} files, ${stats.chunksInserted} inserted, ${stats.chunksDeleted} deleted, ${stats.errors} errors`,
  );
  return stats;
}
