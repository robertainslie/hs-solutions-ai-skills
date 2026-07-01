---
name: property-dependency
description: Map HubSpot CRM properties to their asset dependencies (Forms, Lists, Workflows). Find which properties are safe to archive.
---

# Property Dependency Mapper — Agent CLI

## When to use
Run this when investigating which custom properties are safe to delete, or to understand what's blocking property cleanup.

## Requirements
- `HUBSPOT_ACCESS_TOKEN` with read scopes + `forms` + `crm.lists.read` + `automation`
- Node.js v18+

## Running
```bash
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
node ~/hubspot-skills/packages/crm/skills/property-dependency/src/dependency.js
open dependency-report.html
```

## What it collects
- All custom properties per object
- Form field references (Forms API)
- List/segment filter references (Lists API)
- Workflow enrollment trigger + set-property action references (Automation API)

## Outputs
- `dependency-data.json` — full dependency map
- `dependency-report.html` — interactive report

## Key findings in output
- `canArchive: true` — property has no usages, safe to delete
- `blockingAssets: [...]` — list of assets that must be updated before deletion
- `fieldLevelPermission` — non-null means Enterprise access restriction applies
