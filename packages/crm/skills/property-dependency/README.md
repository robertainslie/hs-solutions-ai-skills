# Property Dependency Mapper

Maps every custom CRM property to the assets that reference it — Forms, Lists (segments), and Workflows — so you know which properties are safe to archive and which are blocked before you try to delete them.

## What It Does

Scans your HubSpot portal and builds a complete dependency map:

- **Forms** — which form fields use each property
- **Lists/Segments** — which list filters reference each property  
- **Workflows** — which workflows are triggered by each property, and which workflows set each property

Outputs:
- `dependency-data.json` — full raw map
- `dependency-report.html` — interactive report with filterable matrix, "safe to archive" section, and blocked property list

## Quick Start

```bash
# 1. Set your Private App token
export HUBSPOT_ACCESS_TOKEN=pat-na1-...

# 2. Run from any directory — report lands here
cd ~/Desktop
node ~/hubspot-skills/packages/crm/skills/property-dependency/src/dependency.js

# 3. Open the report
open dependency-report.html
```

## Authentication

Generate a Private App token: **HubSpot Settings → Integrations → Private Apps → Create app**

### Required Scopes

```
# CRM read (same as audit skill)
crm.schemas.read              crm.objects.contacts.read
crm.objects.companies.read    crm.objects.deals.read
tickets                       crm.objects.custom.read

# Additional scopes (new)
forms                         (list all forms and their fields)
crm.lists.read                (list all segments and their filter definitions)
automation                    (fetch workflow enrollment + action details)
```

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | Yes | — | Private App token |
| `OUTPUT_DIR` | No | cwd | Directory where output files are written |
| `INCLUDE_NATIVE` | No | `0` | Set to `1` to also map HubSpot-defined properties (slower, large output) |

## Outputs

| File | Description |
|------|-------------|
| `dependency-data.json` | Full dependency map per property — usages by forms, lists, workflow triggers, workflow actions |
| `dependency-report.html` | Interactive report — matrix table, safe-to-archive list, blocked list, access-restricted list |

## Key Concepts

**Safe to archive**: A custom property with 0 usages in any asset. Can be deleted via API (`DELETE /crm/v3/properties/{objectType}/{propertyName}`) or HubSpot UI without errors.

**Blocked**: A property referenced by at least one form, list, or workflow. HubSpot will reject deletion attempts — you must remove the property from all referencing assets first.

**Access restricted**: Properties with non-default `fieldLevelPermission` (Enterprise feature). These appear in the report's Access Restrictions section.

## Note on the Internal HubSpot Usage API

HubSpot has an internal UI endpoint (`app.hubspot.com/api/crm-usages/...`) that shows property usage across all asset types including reports. This endpoint requires browser session authentication and **does not work with Private App tokens**. The dependency script tests this endpoint at startup, logs the result, and falls back to the asset-definition approach automatically.

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| 403 on forms | Missing `forms` scope | Add `forms` scope to Private App token |
| 403 on lists | Missing `crm.lists.read` | Add `crm.lists.read` scope |
| 403 on workflows | Missing `automation` scope | Add `automation` scope |
| Empty lists section | All lists are MANUAL type | Expected — MANUAL lists have no filter criteria |
