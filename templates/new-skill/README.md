# Your Skill Name

One-sentence description of what this skill does.

## What It Does

[2-3 paragraph explanation]

## Quick Start

```bash
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
node src/index.js
```

## Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | Yes | Private App token |

## Skill Formats

| File | Format | Usage |
|------|--------|-------|
| `skill.md` | Claude Code | Copy to `.claude/skills/your-skill-name.md` |
| `formats/agent-cli.md` | HubSpot Agent CLI | Compatible with `npx skills add` format |
| `.claude-plugin/plugin.json` | Anthropic Plugin | `claude plugin install ./your-skill-name` |

## Troubleshooting

[Common errors and solutions]
