# Morning digest

A daily digest for **GitHub activity**, **Wikipedia front pages**, and **curated
articles** — filtered to what matters for bioinformatics, AI agents, and terminal
tooling.

Each file in `editions/` is one day's digest, written by the pipeline that
collects the sources and composes the digest itself. There is no model in the
render path, so no provider error can take down a digest.

- [RSS feed](feed.xml)
- Latest edition: see `editions/`

## What is in a digest

| Source | What it contributes |
|---|---|
| GitHub | Your own repositories, your notification inbox filtered to domain releases, activity in the repositories you watch, and trending repositories |
| Wikipedia | The front pages' news, current events, featured articles, "did you know", and "on this day" |
| 科技爱好者周刊 | The newest weekly issue's editorial lead and its curated links |
| Decoding Bio | The newest newsletter post and its lead paragraph |

## Privacy

This repository is public. The personal section — the reader's own repositories
and their private names — is removed before an edition is written here, and so
is any row naming a private repository. The digest that goes to the reader's own
chat keeps them.

## How it works

The collector for each source is declared in `sources.json`, the digest is
composed by the data layer, and a seen-set keeps a story from repeating across
days. See the [source repository](https://github.com/JoJoTsui/github-morning-digest)
for the design and the decisions behind it.
