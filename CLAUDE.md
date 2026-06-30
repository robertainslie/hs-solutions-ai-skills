# HubSpot Solutions AI Skills — Claude Code Guidance

## Project Overview

This is a monorepo of reusable HubSpot AI skills. Skills are Markdown-based instructions that tell Claude how to perform specific HubSpot workflows.

## Repository Structure

- `packages/<domain>/skills/<skill-name>/` — one directory per skill
- `packages/<domain>/skills/<skill-name>/skill.md` — Claude Code skill file
- `packages/<domain>/skills/<skill-name>/src/` — implementation scripts
- `skills-index.json` — machine-readable index of all skills
- `templates/new-skill/` — scaffold for authoring new skills

## Skill Formats

Each skill ships three format variants:
- `skill.md` — Claude Code (drop into `.claude/skills/`)
- `SKILL.md` — HubSpot Agent CLI
- `.claude-plugin/plugin.json` + `commands/` — Anthropic Plugin

## Running the CRM Schema Audit

Requires `HUBSPOT_ACCESS_TOKEN` environment variable (Private App token with CRM read scopes).

```bash
HUBSPOT_ACCESS_TOKEN=pat-na1-... node packages/crm/skills/crm-schema-audit/src/audit.js
```

Outputs:
- `audit-data.json` — raw schema data
- `audit-report.html` — formatted HTML report with ERDs and findings

## Adding a New Skill

1. Copy `templates/new-skill/` to `packages/<domain>/skills/<skill-name>/`
2. Fill in `skill.md`, `SKILL.md`, `.claude-plugin/plugin.json`, and `README.md`
3. Add an entry to `skills-index.json`
4. Add any implementation scripts to `src/`

## HubSpot Authentication

- **Private App token**: HubSpot Settings → Integrations → Private Apps → Create
  Required scopes for CRM Schema Audit: `crm.schemas.read`, `crm.objects.read`
- **HubSpot CLI**: `hubspot auth login` then `hubspot accounts use <portalId>`
- **DevEx MCP**: `hs mcp setup` (requires HubSpot CLI 8.2.0+)

## Skill Index Format

`skills-index.json` uses this schema per entry:
```json
{
  "id": "crm-schema-audit",
  "domain": "crm",
  "name": "CRM Schema Audit",
  "description": "...",
  "formats": ["claude-code", "agent-cli", "plugin"],
  "auth": ["HUBSPOT_ACCESS_TOKEN"],
  "path": "packages/crm/skills/crm-schema-audit",
  "tags": ["crm", "schema", "data-model", "audit"]
}
```
