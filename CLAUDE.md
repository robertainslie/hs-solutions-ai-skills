# HubSpot Solutions AI Skills — Claude Code Guidance

## Project Overview

Monorepo of reusable HubSpot AI skills. Skills are Markdown-based instructions that tell Claude how to perform specific HubSpot workflows, paired with Node.js implementation scripts.

## Repository Structure

```
packages/<domain>/skills/<skill-name>/
  skill.md              Claude Code skill file
  formats/agent-cli.md  HubSpot Agent CLI variant
  .claude-plugin/       Anthropic Plugin manifest
  src/                  Implementation scripts (Node.js)
  README.md             Skill-specific documentation

.claude/skills/         Project-scoped skills (auto-loaded by Claude Code)
skills-index.json       Machine-readable index of all skills
templates/new-skill/    Scaffold for authoring new skills
```

## Running the CRM Schema Audit

Requires `HUBSPOT_ACCESS_TOKEN`. Portal ID is auto-detected from the token.

```bash
# From any directory (report lands in cwd)
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
node packages/crm/skills/crm-schema-audit/src/audit.js

# Faster: skip empty objects
SKIP_UNUSED=1 node packages/crm/skills/crm-schema-audit/src/audit.js

# Full fix analysis: count records per duplicate property pair
CHECK_VALUES=1 node packages/crm/skills/crm-schema-audit/src/audit.js

# Skip workflow audit (saves 2-3 min on large portals)
AUDIT_WORKFLOWS=0 node packages/crm/skills/crm-schema-audit/src/audit.js
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | — | Required. Private App token |
| `OUTPUT_DIR` | cwd | Where to write output files |
| `SKIP_UNUSED` | `0` | `1` = skip property collection for empty objects |
| `CHECK_VALUES` | `0` | `1` = count records per duplicate property pair (unlocks Tier 1/2 fixes) |
| `AUDIT_WORKFLOWS` | `1` | `0` = skip workflow audit |

**Outputs:**
- `audit-data.json` — raw data (objects, properties, pipelines, associations, limits, workflows, findings, fix plan)
- `audit-report.html` — interactive report with ERDs, limits dashboard, workflow audit, fix plan
- `fix-plan.json` — machine-readable fix plan for fix.js

## Running the Fix Script

```bash
# Dry run (default) — shows what would happen, no API calls
node packages/crm/skills/crm-schema-audit/src/fix.js

# Execute interactively — prompts per fix group
node packages/crm/skills/crm-schema-audit/src/fix.js --execute

# Execute a single fix by ID (used by Claude in AI-guided mode)
node packages/crm/skills/crm-schema-audit/src/fix.js --item FIX-001 --execute

# Pipeline-with-records fix (requires destination pipeline ID)
node packages/crm/skills/crm-schema-audit/src/fix.js --item FIX-003 --dest-pipeline <id> --execute

# Use a specific plan file
node packages/crm/skills/crm-schema-audit/src/fix.js --plan ./reports/fix-plan.json --execute

# Skip data backup (not recommended)
node packages/crm/skills/crm-schema-audit/src/fix.js --execute --no-backup
```

Fix.js requires write scopes (`crm.schemas.*.write`, `crm.objects.*.write`) in addition to read scopes.

**AI-guided flow**: `--item FIX-001 --execute` runs a single fix and prints a JSON result line for Claude to parse. Backups are written to `backup-{fixId}.json` before each destructive operation.

## Running the Property Dependency Mapper

Requires `HUBSPOT_ACCESS_TOKEN` with `forms` + `crm.lists.read` + `automation` scopes in addition to standard CRM read scopes.

```bash
# From any directory (report lands in cwd)
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
node packages/crm/skills/property-dependency/src/dependency.js

# Also map HubSpot-defined properties (larger output)
INCLUDE_NATIVE=1 node packages/crm/skills/property-dependency/src/dependency.js
```

**Environment variables:**

| Variable | Default | Description |
|----------|---------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | — | Required. Private App token |
| `OUTPUT_DIR` | cwd | Where to write output files |
| `INCLUDE_NATIVE` | `0` | `1` = also map HubSpot-defined properties |

**Outputs:**
- `dependency-data.json` — full property dependency map
- `dependency-report.html` — interactive report (matrix, safe-to-archive list, blocked list)

## Adding a New Skill

1. Copy `templates/new-skill/` to `packages/<domain>/skills/<skill-name>/`
2. Fill in `skill.md`, `formats/agent-cli.md`, `.claude-plugin/plugin.json`, and `README.md`
3. Add an entry to `skills-index.json`
4. Add implementation scripts to `src/`

## HubSpot Authentication

- **Private App token**: HubSpot Settings → Integrations → Private Apps → Create
- **HubSpot CLI**: `hubspot auth login` then `hubspot accounts use <portalId>`
- **DevEx MCP**: `hs mcp setup` (requires HubSpot CLI 8.2.0+)

## Gitignored — Do Not Commit

- `.env` — tokens and secrets
- `.claude/settings.local.json` — personal Claude Code permissions (may contain token paths)
- `solutions-ai-skills-testing/` — local test output; use this directory for all test runs
- `audit-data.json`, `audit-report.html`, `fix-plan.json`, `fix-log.json` — generated artifacts

## Skill Index Format

```json
{
  "id": "crm-schema-audit",
  "domain": "crm",
  "name": "CRM Schema Audit",
  "description": "...",
  "formats": ["claude-code", "agent-cli", "plugin"],
  "auth": ["HUBSPOT_ACCESS_TOKEN"],
  "path": "packages/crm/skills/crm-schema-audit",
  "tags": ["crm", "schema", "data-model", "audit", "pipelines", "limits", "workflows"]
}
```
