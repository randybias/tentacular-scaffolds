import type { Context } from "tentacular";
import { Client } from "jsr:@db/postgres@0.19.5";
import { connect } from "https://deno.land/x/nats@v1.28.2/src/mod.ts";

interface Source {
  fileName: string;
  chunkText: string;
  similarity: number;
}

interface AnswerResult {
  answer: string;
  sources: Source[];
  query: string;
}

/** Generate an embedding for the query using OpenAI */
async function getQueryEmbedding(ctx: Context, query: string): Promise<number[]> {
  const openai = ctx.dependency("openai");
  if (!openai.secret) {
    throw new Error("No openai.api_key in secrets");
  }

  const res = await openai.fetch!("/v1/embeddings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "text-embedding-ada-002",
      input: query,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embeddings API failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.data[0].embedding;
}

/** Call Anthropic Claude to generate an answer with citations */
async function generateAnswer(
  ctx: Context,
  query: string,
  sources: Source[],
): Promise<string> {
  const anthropic = ctx.dependency("anthropic");
  if (!anthropic.secret) {
    throw new Error("No anthropic.api_key in secrets");
  }

  const contextText = sources
    .map((s, i) => `[Source ${i + 1}: ${s.fileName}]\n${s.chunkText}`)
    .join("\n\n---\n\n");

  const systemPrompt = `You are a helpful knowledge base assistant. Answer the user's question based ONLY on the provided source documents. Always cite your sources using [Source N] notation. If the sources don't contain enough information to answer, say so clearly.`;

  const userMessage = `Here are the relevant source documents:\n\n${contextText}\n\n---\n\nQuestion: ${query}`;

  const res = await anthropic.fetch!("/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 2048,
      system: systemPrompt,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Anthropic API failed: ${res.status} ${body}`);
  }

  const data = await res.json();
  return data.content?.[0]?.text ?? "No answer generated.";
}

/** Publish usage event to NATS */
async function publishUsageEvent(
  ctx: Context,
  query: string,
  sourcesCount: number,
): Promise<void> {
  const nats = ctx.dependency("tentacular-nats");
  if (!nats.secret) {
    ctx.log.warn("No NATS token, skipping usage event");
    return;
  }

  try {
    const nc = await connect({
      servers: `${nats.host}:${nats.port}`,
      token: nats.secret,
    });

    const event = JSON.stringify({
      type: "kb.query",
      query,
      sourcesReturned: sourcesCount,
      timestamp: new Date().toISOString(),
    });

    nc.publish("tentacular.kb.usage", new TextEncoder().encode(event));
    await nc.flush();
    await nc.close();

    ctx.log.info("Published usage event to NATS");
  } catch (err) {
    ctx.log.warn(`Failed to publish NATS event: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Answer a question using vector similarity search and LLM generation with source citations */
export default async function run(ctx: Context, _input: unknown): Promise<AnswerResult> {
  // Access dependencies early for contract drift detection
  const _anthropic = ctx.dependency("anthropic");
  const _nats = ctx.dependency("tentacular-nats");
  const _slack = ctx.dependency("slack-webhook");
  const postgres = ctx.dependency("tentacular-postgres");

  const query = ctx.config.query as string;
  if (!query || query.trim() === "") {
    ctx.log.error("No query provided in config");
    return { answer: "No query provided.", sources: [], query: "" };
  }

  const topK = (ctx.config.top_k as number) ?? 5;
  ctx.log.info(`Answering query: "${query}" (top_k=${topK})`);

  // Step 1: Generate embedding for the question
  ctx.log.info("Generating query embedding");
  const queryVector = await getQueryEmbedding(ctx, query);
  const vectorStr = `[${queryVector.join(",")}]`;

  // Step 2: Vector similarity search in Postgres
  if (!postgres.secret) {
    ctx.log.error("No postgres.password in secrets");
    return { answer: "Database not available.", sources: [], query };
  }

  const client = new Client({
    hostname: postgres.host,
    port: postgres.port,
    database: postgres.database,
    user: postgres.user,
    password: postgres.secret,
    tls: { enabled: false },
  });

  const sources: Source[] = [];

  try {
    await client.connect();

    const searchQuery = `
      SELECT file_name, text, 1 - (embedding <=> $1::vector) AS similarity
      FROM kb_chunks
      ORDER BY embedding <=> $1::vector
      LIMIT $2;
    `;

    const result = await client.queryArray(searchQuery, [vectorStr, topK]);

    for (const row of result.rows) {
      sources.push({
        fileName: String(row[0]),
        chunkText: String(row[1]),
        similarity: Number(row[2]),
      });
    }

    ctx.log.info(`Found ${sources.length} matching chunks (best similarity: ${sources[0]?.similarity.toFixed(4) ?? "N/A"})`);
  } finally {
    await client.end();
  }

  if (sources.length === 0) {
    return { answer: "No relevant documents found in the knowledge base.", sources: [], query };
  }

  // Step 3: Generate answer with LLM
  ctx.log.info("Generating answer with Claude");
  const answer = await generateAnswer(ctx, query, sources);

  // Step 4: Publish usage event to NATS
  await publishUsageEvent(ctx, query, sources.length);

  ctx.log.info("Answer generated successfully");
  return { answer, sources, query };
}
