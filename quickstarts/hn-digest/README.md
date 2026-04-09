# hn-digest

Fetches top Hacker News stories, filters them by relevance criteria, and formats a digest. A minimal three-node linear pipeline.

## Nodes

- **fetch-stories** -- Fetch top stories from the Hacker News Firebase API
- **filter-stories** -- Filter stories based on score, topic, or other criteria
- **format-digest** -- Format filtered stories into a readable digest

## Dependencies

- **hn** -- Hacker News Firebase API (no auth required)

## Trigger

- Manual only
