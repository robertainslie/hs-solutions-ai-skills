# CRM Schema Audit

Audits a HubSpot portal's full CRM data model and workflow configuration, generates a prioritized fix plan, and provides an interactive fix script to apply changes safely.

## What It Does

**audit.js** — collects and analyzes:

1. All 30+ native CRM object types plus custom objects — with record sampling to flag which are in use vs. empty
2. Properties for every object — type, fieldType, hasUniqueValue, description, hubspotDefined
3. Pipelines with stage breakdown and record counts for all pipeline-enabled objects
4. Association types between all accessible object pairs
5. Property validation rules
6. CRM limits — records, properties, pipelines, custom objects, association labels
7. **All workflows** — enrollment type, action types, enabled/disabled state, and common issues

**Property findings:**
| Severity | Issue |
|----------|-------|
| Critical | Exact duplicate property labels on the same object |
| Warning | Near-duplicate labels (possible duplicates) |
| Warning | Custom properties missing a description |
| Info | Custom unique identifier properties |
| Info | Same label across multiple objects |
| Info | Naming convention inconsistencies |

**Workflow findings:**
| Severity | Issue |
|----------|-------|
| Critical | Workflows with zero actions configured |
| Critical | Test or junk workflow names ("test", "asdf", "New Workflow", etc.) |
| Warning | Re-enrollment enabled on workflows that send email |
| Warning | Disabled workflows that were never edited (abandoned drafts) |
| Warning | Duplicate workflow names |
| Info | Active workflows with webhook or custom code actions |
| Info | Manual-enrollment-only disabled workflows |

**Produces a prioritized fix plan** (`fix-plan.json`) with three tiers:
- **Tier 1** — Auto-fixable, no data risk (archive empty properties, archive empty pipelines)
- **Tier 2** — Auto-fixable with confirmation (migrate property values then archive, move pipeline records then archive)
- **Tier 3** — Manual review required (near-duplicates, naming issues, workflow cleanup)

**fix.js** — reads `fix-plan.json` and executes fixes interactively:
- Default: `--dry-run` shows exactly what would happen
- `--execute`: prompts per fix group, migrates records in batches of 100, logs all actions to `fix-log.json`

**Report links:**
- [HubSpot Data Model Viewer](https://app.hubspot.com/l/data-model-overview/)
- [Data Quality Command Center](https://app.hubspot.com/l/data-quality/)
- [Data Quality Tools guide](https://knowledge.hubspot.com/data-management/use-data-quality-tools)

---

## Quick Start

```bash
# 1. Set your Private App token
export HUBSPOT_ACCESS_TOKEN=pat-na1-...

# 2. Run the audit from any directory — report lands here
cd ~/Desktop
node ~/hubspot-skills/packages/crm/skills/crm-schema-audit/src/audit.js

# 3. Open the report
open audit-report.html

# 4. Preview fixes (dry run — no changes made)
node ~/hubspot-skills/packages/crm/skills/crm-schema-audit/src/fix.js

# 5. Apply fixes interactively
node ~/hubspot-skills/packages/crm/skills/crm-schema-audit/src/fix.js --execute
```

---

## Authentication

Generate a Private App token: **HubSpot Settings → Integrations → Private Apps → Create app**

### Scopes for audit (read-only)

```
crm.schemas.read              crm.schemas.custom.read
crm.objects.contacts.read     crm.objects.companies.read
crm.objects.deals.read        tickets
crm.objects.goals.read        crm.objects.invoices.read
crm.objects.leads.read        crm.objects.line_items.read
crm.objects.orders.read       crm.objects.products.read
crm.objects.quotes.read       crm.objects.services.read
crm.objects.appointments.read crm.objects.carts.read
crm.objects.courses.read      crm.objects.listings.read
crm.objects.subscriptions.read crm.objects.users.read
crm.objects.feedback_submissions.read
crm.objects.custom.read
automation                    (for workflow audit)
```

### Additional scopes for fix.js (write)

```
crm.schemas.contacts.write    crm.schemas.companies.write
crm.schemas.deals.write
crm.objects.contacts.write    crm.objects.companies.write
crm.objects.deals.write       tickets (includes write)
```

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `HUBSPOT_ACCESS_TOKEN` | Yes | — | Private App token |
| `HUBSPOT_PORTAL_ID` | No | auto-detected | Auto-resolved from token via `GET /account-info/v3/details` |
| `OUTPUT_DIR` | No | cwd | Directory where output files are written |
| `SKIP_UNUSED` | No | `0` | Set to `1` to skip property collection for empty objects (faster) |
| `CHECK_VALUES` | No | `0` | Set to `1` to count records per duplicate property pair — unlocks Tier 1/2 fixes |
| `AUDIT_WORKFLOWS` | No | `1` | Set to `0` to skip workflow audit (saves ~2–3 min on large portals) |

---

## Outputs

| File | Description |
|------|-------------|
| `audit-data.json` | Full raw data: objects, properties, pipelines, associations, limits, validations, workflows, findings, fix plan |
| `audit-report.html` | Interactive HTML report — ERD diagrams, object inventory, limits dashboard, workflow audit, fix plan, filterable findings |
| `fix-plan.json` | Machine-readable fix plan consumed by `fix.js` |
| `fix-log.json` | Written by `fix.js` — log of every action taken |

---

## Native Object Types Covered

All 30+ native types attempted. Objects not in the portal or lacking API access are skipped gracefully.

Appointments · Carts · Commerce Payments · Commerce Subscriptions · Communications · Companies · Contacts · Courses · Custom Objects · Deals · Discounts · Feedback Submissions · Fees · Goals · Invoices · Leads · Line Items · Listings · Orders · Partner Clients · Partner Services · Products · Projects · Quotes · Services · Taxes · Tickets · Users

**Pipeline-enabled:** Appointments · Courses · Deals · Leads · Listings · Orders · Services · Tickets · Custom Objects (Enterprise)

---

## Skill Formats

| File | Format |
|------|--------|
| `skill.md` | Claude Code — symlink or copy to `~/.claude/skills/` |
| `formats/agent-cli.md` | HubSpot Agent CLI |
| `.claude-plugin/plugin.json` | Anthropic Plugin |

---

## Troubleshooting

| Error | Cause | Fix |
|-------|-------|-----|
| 401 Unauthorized | Token invalid or expired | Regenerate Private App token |
| 403 on object/workflow | Missing scope | Add `crm.objects.{type}.read` or `automation` scope |
| Object skipped (not found) | Object not in this portal tier | Expected — audit continues |
| 0 association types | Missing scope or wrong endpoint | Ensure read scopes cover both objects in the pair |
| Limits endpoint null | Pro/Enterprise required | Expected for association labels, calculated properties |
| Workflows not in report | Missing `automation` scope | Add `automation` scope to token |
| fix.js 403 on archive | Missing write scope | Add `crm.schemas.{object}.write` to token |
