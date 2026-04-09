# knowledge-base-rag

Ingests documents from Google Drive, generates embeddings via OpenAI, stores vectors in pgvector, and answers questions with source citations using Claude. The ingest pipeline (poll, store, chunk, embed, store vectors) runs on a daily cron. The answer-query node is an independent manual entry point for querying the knowledge base.

## Nodes

- **poll-drive** -- Poll Google Drive folders for new or updated documents
- **store-originals** -- Store original documents in RustFS
- **extract-and-chunk** -- Extract text and split into chunks for embedding
- **generate-embeddings** -- Generate vector embeddings via OpenAI API
- **store-vectors** -- Store embeddings in pgvector for similarity search
- **answer-query** -- Answer a user question using RAG with source citations

## Dependencies

- **google-drive** -- Google Drive API (bearer token) for document ingestion
- **openai** -- OpenAI API (bearer token) for embedding generation
- **tentacular-rustfs** -- RustFS for storing original documents
- **tentacular-postgres** -- PostgreSQL with pgvector for vector storage
- **tentacular-nats** -- NATS messaging
- **anthropic** -- Anthropic API (bearer token) for answering queries
- **slack-webhook** -- Slack incoming webhook for notifications

## Trigger

- Manual
- Cron: daily at 06:00 UTC (`0 6 * * *`)

## Prompts

1 LLM prompt (answer-query) for RAG question answering with source citations.

## Prompts

1 prompt defined in `prompts.yaml`.
