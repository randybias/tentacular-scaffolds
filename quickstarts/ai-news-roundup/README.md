# ai-news-roundup

Daily AI and agentic news roundup. Fetches RSS feeds and JSON APIs from multiple tech news sources, filters articles to the last 24 hours, summarizes them via LLM, and posts a digest to Slack.

## Nodes

- **fetch-feeds** -- Pull articles from RSS feeds (TechCrunch, The Verge, Ars Technica, VentureBeat) and Hacker News API
- **filter-24h** -- Filter articles to only those published in the last 24 hours
- **summarize-llm** -- Summarize filtered articles using OpenAI GPT-4o
- **notify-slack** -- Post the formatted digest to Slack

## Dependencies

- **openai-api** -- OpenAI API (bearer token) for summarization
- **slack** -- Slack incoming webhook for posting the digest
- **news-sources** -- Dynamic HTTPS targets for RSS/JSON feeds

## Trigger

- Manual
- Cron: daily at 07:00 UTC (`0 7 * * *`)

## Prompts

1 LLM prompt (summarize-llm) and 1 template (Slack notification).

## Prompts

1 prompt and 1 template defined in `prompts.yaml`.
