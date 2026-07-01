---
name: property-dependency
description: Map every custom HubSpot CRM property to the assets that reference it (Forms, Lists, Workflows). Identify which properties are safe to archive vs. blocked before deletion. Requires HUBSPOT_ACCESS_TOKEN with forms + crm.lists.read + automation scopes.
---

# HubSpot Property Dependency Mapper

## When to use this skill

Use this skill when someone asks to:
- "Which properties are safe to delete/archive?"
- "Why can't I delete this property?" / "What's using property X?"
- "Show me which forms, lists, or workflows use a property"
- "Find unused custom properties"
- "Which properties are blocking our schema cleanup?"
- Check property access restrictions before a team reorganization

## Prerequisites

### 1. HubSpot CLI (optional)
Check if installed: `hubspot --version`

### 2. Private App Token
Set before running:
```bash
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
```

Token must include all CRM read scopes PLUS:
- `forms` — list all forms
- `crm.lists.read` — list all segments with filters
- `automation` — fetch workflow details

Generate at: HubSpot Settings → Integrations → Private Apps → Create app

### 3. Node.js v18+
```bash
node --version
```

## Installation

### From the repo (recommended)
```bash
git clone https://github.com/robertainslie/hs-solutions-ai-skills ~/hubspot-skills
```

### Global skill symlink
```bash
mkdir -p ~/.claude/skills
ln -sf ~/hubspot-skills/packages/crm/skills/property-dependency/skill.md \
       ~/.claude/skills/property-dependency.md
```

## Running the Skill

```bash
# From any directory — report lands here
cd ~/Desktop
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
node ~/hubspot-skills/packages/crm/skills/property-dependency/src/dependency.js

# Open the report
open dependency-report.html

# Also map HubSpot-defined properties (larger output)
INCLUDE_NATIVE=1 node ~/hubspot-skills/packages/crm/skills/property-dependency/src/dependency.js
```

## What Gets Collected

| Source | Endpoint | Scope | What's extracted |
|--------|----------|-------|-----------------|
| Properties | `GET /crm/v3/properties/{objectType}` | existing read scopes | All property definitions + `fieldLevelPermission` |
| Forms | `GET /forms/v2/forms?formTypes=ALL` | `forms` | `formFieldGroups[].fields[].name` (property names) |
| Lists | `POST /crm/lists/2026-03/search` + `GET /crm/lists/2026-03/{id}?includeFilters=true` | `crm.lists.read` | Filter branch recursive walk for `PROPERTY` type filters |
| Workflows | `GET /automation/v4/flows/{id}` | `automation` | Enrollment criteria property filters + `0-5` set-property action fields |

**Note**: The internal HubSpot usage API (`app.hubspot.com/api/crm-usages/...`) requires browser session auth and will not work with a Private App token. The script tests it and falls back automatically.

## Interpreting the Report

**Property Dependency Matrix** — rows = custom properties, columns = Forms / Lists / WF-Trigger / WF-Action / Total
- Green rows = safe to archive (0 usages in any asset)
- Hover over a count cell to see which assets use it

**Safe to Archive** — properties with no usages; can be deleted via API or HubSpot UI

**Blocked** — properties in use; HubSpot will reject deletion. Remove them from all listed assets first.

**Access Restricted** — Enterprise-only: properties with `fieldLevelPermission` set

## Outputs

| File | Description |
|------|-------------|
| `dependency-data.json` | Full raw map per property with all usages |
| `dependency-report.html` | Interactive report — matrix, safe list, blocked list |

## After Running

1. Review the "Safe to Archive" section — those can be deleted immediately
2. For blocked properties: open the blocking assets (forms/lists/workflows) and remove the property reference
3. Re-run after cleanup to confirm the property shows as "safe to archive"
4. Use `DELETE /crm/v3/properties/{objectType}/{propertyName}` or HubSpot UI to archive

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| 403 on forms | Missing `forms` scope | Add to Private App token |
| 403 on lists | Missing `crm.lists.read` | Add to Private App token |
| 403 on workflows | Missing `automation` scope | Add to Private App token |
| Property shows blocked but not found in UI | May be referenced by a hidden/system asset | Check HubSpot Support |
| Large portal taking long | Lists API fetches filter details per list | Normal — 500+ lists may take several minutes |
