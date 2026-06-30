# CRM Schema Audit

Audits a HubSpot portal's full CRM data model and generates an HTML report with Mermaid.js ERD diagrams.

## When to Use

- The user wants to understand their CRM data model
- The user asks about duplicate, similar, or redundant properties
- The user wants an ERD of their HubSpot objects and relationships
- The user wants to clean up or document their schema
- The user says "I can't access the schema from the API" — this skill resolves that

## Requirements

- `HUBSPOT_ACCESS_TOKEN` environment variable — Private App token with scopes:
  - `crm.schemas.read`
  - `crm.objects.schemas.read`
- Node.js 20+
- HubSpot CLI (optional — improves data collection, script falls back to REST if not present)

## Setup

```bash
# Install HubSpot CLI (optional but recommended)
npm install -g @hubspot/cli
hubspot auth login

# Set your API token
export HUBSPOT_ACCESS_TOKEN=pat-na1-your-token-here

# Optional: set portal ID for direct Data Model Viewer link
export HUBSPOT_PORTAL_ID=12345678
```

## Running the Audit

```bash
node packages/crm/skills/crm-schema-audit/src/audit.js
```

## What Gets Collected

| Data | Source | Fallback |
|------|--------|---------|
| Custom object schemas | `hubspot schemas list` | `GET /crm/v3/schemas` |
| Properties per object | `hubspot properties list --type <type>` | `GET /crm/v3/properties/{type}` |
| Association types | REST API only | — |

Native object types always collected: contacts, companies, deals, tickets, calls, emails, meetings, notes, tasks, products, line_items, quotes.

## Outputs

After running, two files are created in the current directory:

- `audit-data.json` — machine-readable schema data and findings
- `audit-report.html` — HTML report with:
  - Summary cards (objects, properties, issue counts)
  - Object inventory table
  - Mermaid.js ERD diagrams (Full Model / Contact-Centric / Deal Pipeline)
  - Filterable audit findings table
  - Recommended cleanup steps
  - Link to [HubSpot Data Model Viewer](https://app.hubspot.com/l/data-model-overview/)

## Findings Categories

| Severity | Description |
|----------|-------------|
| Critical | Exact duplicate property labels on the same object |
| Warning | Highly similar labels (possible duplicates), missing descriptions |
| Info | Cross-object label duplication, naming convention inconsistencies |

## Piping Support

The raw schema data can be piped for further processing:

```bash
node audit.js && cat audit-data.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); const p=JSON.parse(d); console.log(JSON.stringify(p.findings,null,2))"
```
