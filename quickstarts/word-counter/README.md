# word-counter

E2E test scaffold that tokenizes text and counts words. A minimal 3-node DAG with zero external dependencies, used for validating the Tentacular engine pipeline end-to-end.

## Nodes

- **source** -- Provides input text
- **tokenize** -- Splits text into tokens/words
- **report** -- Produces a word count report from the tokenized output

## Dependencies

None.

## Trigger

- **manual**
