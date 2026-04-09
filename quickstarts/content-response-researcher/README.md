# content-response-researcher

Researches a competitor article to find contrarian angles and evidence gaps, then produces a structured response outline. Fetches the target article, fans out to three parallel research tracks (supporting evidence, contrary evidence, adjacent topics) via Tavily search API, synthesizes gaps using Claude, generates a response outline, and stores results with Slack notification.

## Nodes

- **fetch-article** -- Fetch and parse the target article content
- **research-supporting** -- Search for evidence supporting the article's claims
- **research-contrary** -- Search for evidence contradicting the article's claims
- **research-adjacent** -- Search for related topics the article missed
- **synthesize-gaps** -- Synthesize research results to identify evidence gaps and angles
- **generate-outline** -- Produce a structured response outline from the synthesis
- **store-and-notify** -- Store the outline in Postgres/RustFS and notify via Slack

## Dependencies

- **probe-targets** -- Dynamic HTTPS targets for fetching the article
- **tavily** -- Tavily search API (bearer token) for web research
- **tentacular-rustfs** -- RustFS for storing research artifacts
- **tentacular-postgres** -- PostgreSQL for storing structured results
- **anthropic** -- Anthropic API (bearer token) for synthesis and outline generation
- **slack-webhook** -- Slack incoming webhook for notifications

## Trigger

- Manual only

## Prompts

2 LLM prompts (synthesize-gaps, generate-outline) and 1 template (Slack notification).

## Prompts

2 prompts and 1 template defined in `prompts.yaml`.
