# CRM Schema Audit

Audits a HubSpot portal's full CRM data model and generates an HTML report with Mermaid.js ERD diagrams.

## What It Does

1. **Collects** all CRM object types (native + custom), all their properties (via HubSpot CLI when available, REST API for full metadata), and all association types between objects
2. **Analyzes** properties for common issues:
   - Exact duplicate labels on the same object (Critical)
   - Highly similar labels — possible duplicates (Warning)
   - Custom properties missing a description (Warning)
   - Same label appearing on multiple objects (Info)
   - Naming convention inconsistencies within an object (Info)
3. **Generates** an HTML report with:
   - Summary stat cards
   - Object inventory table
   - Three Mermaid.js ERD diagram views (Full Model, Contact-Centric, Deal Pipeline)
   - Filterable findings table with severity and recommendations
   - Recommended cleanup order
   - Link to the [HubSpot Data Model Viewer](https://app.hubspot.com/l/data-model-overview/)

## Quick Start

```bash
# 1. Get a HubSpot Private App token
#    HubSpot Settings → Integrations → Private Apps → Create
#    Required scopes: crm.schemas.read, crm.objects.schemas.read

# 2. Run the audit
HUBSPOT_ACCESS_TOKEN=pat-na1-... node src/audit.js

# 3. Open the report
open audit-report.html
```

## Authentication

| Variable | Required | Description |
|----------|----------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | Yes | Private App token with `crm.schemas.read` |
| `HUBSPOT_PORTAL_ID` | No | Portal ID — enables direct Data Model Viewer link |
| `OUTPUT_DIR` | No | Directory for output files (default: current directory) |

## Data Collection Strategy

The script uses a **hybrid CLI + REST API** approach:

| Data | Primary | Fallback |
|------|---------|---------|
| Custom schemas | `hubspot schemas list` | `GET /crm/v3/schemas` |
| Properties | `hubspot properties list` + REST supplement | `GET /crm/v3/properties/{type}` |
| Association types | REST API | — |

The CLI is optional — the script automatically falls back to REST if the HubSpot CLI is not installed.

## Outputs

| File | Description |
|------|-------------|
| `audit-data.json` | Raw schema data: all objects, properties, associations, and findings |
| `audit-report.html` | Interactive HTML report with ERDs and filterable findings |

## Skill Formats

This skill is available in three formats:

| File | Format | Usage |
|------|--------|-------|
| `skill.md` | Claude Code | Copy to `.claude/skills/crm-schema-audit.md` in your project |
| `SKILL.md` | HubSpot Agent CLI | Compatible with `npx skills add` format |
| `.claude-plugin/plugin.json` | Anthropic Plugin | `claude plugin install ./crm-schema-audit` |

## Troubleshooting

**401 Unauthorized**: Regenerate your Private App token in HubSpot Settings.

**403 Forbidden / missing properties**: Add missing scopes to your Private App:
- `crm.schemas.read` — required for object schemas
- `crm.objects.schemas.read` — required for property metadata

**Empty properties for `calls`, `emails`, etc.**: These engagement objects may require additional scopes:
- `crm.objects.calls.read`
- `crm.objects.emails.read`

**CLI not found message**: This is expected if HubSpot CLI is not installed. The script uses the REST API only — output is identical.
