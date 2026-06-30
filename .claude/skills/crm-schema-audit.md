---
name: crm-schema-audit
description: Run a full HubSpot CRM schema audit — collects all 30+ native object types plus custom objects, checks which objects are in use (record sampling), fetches properties with unique-identifier and validation metadata, retrieves pipelines for all pipeline-enabled objects, and pulls CRM limits data. Produces an HTML report with ERD diagrams, findings, usage status, pipeline summary, and limits dashboard. Use when the user asks to audit their CRM schema, find duplicate/redundant properties, visualize their data model, review naming conventions, understand limits, check pipeline configuration, or build a complete picture of their CRM state.
---

# CRM Schema Audit

## When to use this skill

Invoke this skill when the user asks to:
- Audit or review their HubSpot CRM schema or data model
- Understand which objects are actually in use vs. empty
- Find duplicate, similar, or redundant properties
- Get an ERD diagram of their HubSpot data model
- Review pipelines across all supported objects
- Check CRM limits (records, properties, pipelines, custom objects)
- Audit property validation rules
- Find unique identifier properties and understand deduplication
- Clean up CRM properties or understand what properties exist
- Review naming conventions or missing descriptions across objects

## Installation

### Claude Desktop (global — works from any project)

This is the recommended path for a user who downloads the skill from GitHub and wants it available everywhere in Claude Desktop.

**One-time setup:**

```bash
# 1. Clone the repo to a permanent location (pick anywhere you like)
git clone https://github.com/robertainslie/hs-solutions-ai-skills ~/hubspot-skills

# 2. Make sure Node.js is installed
node --version   # should print v18 or higher; install from nodejs.org if not

# 3. Install the skill into Claude's global skills directory
mkdir -p ~/.claude/skills
cp ~/hubspot-skills/packages/crm/skills/crm-schema-audit/skill.md \
   ~/.claude/skills/crm-schema-audit.md
```

**Restart Claude Desktop** if it was already open so it picks up the new skill file.

Start a new conversation and type:
> "audit my HubSpot CRM schema"

Claude will walk through the prerequisites and run the script from `~/hubspot-skills/` automatically. If you cloned the repo to a different path, tell Claude — it will adjust.

> **Keep it up to date:** When the repo changes, run `git pull` in `~/hubspot-skills/` and re-copy the skill file.
> ```bash
> cd ~/hubspot-skills && git pull
> cp packages/crm/skills/crm-schema-audit/skill.md ~/.claude/skills/crm-schema-audit.md
> ```

---

### Claude Code CLI (global — invoke from any directory)

This is the recommended way to use this skill from Claude Code. The script lives permanently in `~/hubspot-skills/` — you invoke the skill from whatever directory you're actually working in, and the report lands there.

**One-time setup (same clone as above if already done):**

```bash
# Clone if you haven't already
git clone https://github.com/robertainslie/hs-solutions-ai-skills ~/hubspot-skills

# Symlink the skill into Claude's global skills directory
# (symlink means git pull updates it automatically — no re-copy needed)
mkdir -p ~/.claude/skills
ln -sf ~/hubspot-skills/packages/crm/skills/crm-schema-audit/skill.md \
       ~/.claude/skills/crm-schema-audit.md
```

**Running the skill:**

```bash
# Go to wherever you want the report to land — NOT the skills repo
cd ~/Desktop          # or ~/Downloads, or any project folder
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
claude
```

Then in Claude Code:
```
/crm-schema-audit
```
or just ask: *"audit my HubSpot CRM schema"*

Claude Code reads the global skill, runs the script from `~/hubspot-skills/`, and writes `audit-report.html` and `audit-data.json` into your current directory (`~/Desktop` in this example).

> **Why not run from the skills repo directory?** The report files land in cwd. Running from inside `~/hubspot-skills/` would drop audit output into the repo itself, mixing generated files with source code. Run from a neutral location — Desktop, Downloads, or a dedicated reports folder.

**To control exactly where the report lands regardless of cwd:**
```bash
export OUTPUT_DIR=~/reports/crm-audits
```

Using a symlink means updates from `git pull` are reflected immediately — no re-copy needed.

---

## Prerequisites — Environment Check Hierarchy

Walk through these checks **in order** before running the script. Each step gates the next.

### Step 1 — HubSpot CLI (optional, non-blocking)

Check whether the HubSpot CLI is installed:
```bash
hubspot --version
```
- **Installed**: the script uses it for schema collection, supplemented by REST.
- **Not installed**: the script falls back entirely to REST. Note this to the user but continue.

### Step 2 — Token present (required, blocking)

Check whether `HUBSPOT_ACCESS_TOKEN` is set:
```bash
echo $HUBSPOT_ACCESS_TOKEN
```
- **Set**: continue.
- **Missing**: stop. Ask the user to generate a Private App token:
  > HubSpot Settings → Integrations → Private Apps → Create app
  >
  > Recommended scopes for a full audit:
  > `crm.schemas.read`, `crm.schemas.custom.read`, `crm.objects.contacts.read`,
  > `crm.objects.companies.read`, `crm.objects.deals.read`, `tickets`,
  > `crm.objects.goals.read`, `crm.objects.invoices.read`, `crm.objects.leads.read`,
  > `crm.objects.line_items.read`, `crm.objects.orders.read`, `crm.objects.products.read`,
  > `crm.objects.quotes.read`, `crm.objects.services.read`, `crm.objects.appointments.read`,
  > `crm.objects.carts.read`, `crm.objects.courses.read`, `crm.objects.listings.read`,
  > `crm.objects.subscriptions.read`, `crm.objects.users.read`,
  > `crm.objects.feedback_submissions.read`, `crm.objects.custom.read`
  >
  > Then: `export HUBSPOT_ACCESS_TOKEN=pat-na1-...`

### Step 3 — Token valid (required, blocking)

The script validates the token automatically by calling `GET /account-info/v3/details`.
- **200 OK**: token is valid. The response includes `portalId` and `dataHostingLocation`.
- **401**: token is invalid or expired. Stop — ask the user to regenerate it.
- **Other error**: warn the user but continue (the token may still work for CRM APIs).

### Step 4 — Portal ID (optional, auto-detected)

The script reads `portalId` from the `/account-info/v3/details` response and sets it automatically — the user does **not** need to provide `HUBSPOT_PORTAL_ID` separately.

- If `HUBSPOT_PORTAL_ID` was **not provided**: the script uses the resolved value from the token.
- If `HUBSPOT_PORTAL_ID` **was provided**: the script compares it against the token's portal ID.

### Step 5 — Token/portal mismatch (validation)

If the user-supplied `HUBSPOT_PORTAL_ID` doesn't match the portal the token belongs to:
- Warn the user clearly: *"Your token is for portal X, but HUBSPOT_PORTAL_ID is set to Y."*
- The script overrides with the token's portal ID so the report link is correct.
- Ask the user to confirm they're using the right token for the right portal.

### Optional env vars

- **`SKIP_UNUSED=1`** — skips property collection for objects with no records. Speeds up the audit on large portals.

## Running the audit

**From Claude Desktop or Claude Code (global install) — token only, portal ID auto-detected:**
```bash
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
node ~/hubspot-skills/packages/crm/skills/crm-schema-audit/src/audit.js
```

**From inside the repo (Claude Code CLI):**
```bash
export HUBSPOT_ACCESS_TOKEN=pat-na1-...
node packages/crm/skills/crm-schema-audit/src/audit.js
```

**Skip objects with no records (faster on large portals):**
```bash
HUBSPOT_ACCESS_TOKEN=pat-na1-... SKIP_UNUSED=1 \
  node ~/hubspot-skills/packages/crm/skills/crm-schema-audit/src/audit.js
```

**Custom output directory:**
```bash
HUBSPOT_ACCESS_TOKEN=pat-na1-... OUTPUT_DIR=~/Desktop/crm-audit \
  node ~/hubspot-skills/packages/crm/skills/crm-schema-audit/src/audit.js
```

The script resolves and prints the portal ID automatically from the token — you do not need to set `HUBSPOT_PORTAL_ID` manually.

## Native object types covered

The audit attempts to collect data for all 30 native CRM object types. Objects that don't exist in the portal or lack API access are skipped gracefully.

| Object | Object Type ID | Pipelines | API Name |
|--------|----------------|-----------|----------|
| Appointments | `0-421` | ✓ | `appointments` |
| Carts | `0-142` | — | `carts` |
| Commerce Payments | `0-101` | — | `0-101` |
| Commerce Subscriptions | `0-69` | — | `0-69` |
| Communications | `0-18` | — | `communications` |
| Companies | `0-2` | — | `companies` |
| Contacts | `0-1` | — | `contacts` |
| Courses | `0-410` | ✓ | `courses` |
| Custom Objects | `2-XXX` | ✓ (Enterprise) | from schemas API |
| Deals | `0-3` | ✓ | `deals` |
| Discounts | `0-84` | — | `discounts` |
| Feedback Submissions | `0-19` | — | `feedback_submissions` |
| Fees | `0-85` | — | `fees` |
| Goals | `0-74` | — | `goals` |
| Invoices | `0-53` | — | `invoices` |
| Leads | `0-136` | ✓ (Sales Hub Pro+) | `leads` |
| Line Items | `0-8` | — | `line_items` |
| Listings | `0-420` | ✓ | `listings` |
| Orders | `0-123` | ✓ | `orders` |
| Partner Clients | varies | — | `partner-clients` |
| Partner Services | varies | — | `partner-services` |
| Products | `0-7` | — | `products` |
| Projects | `0-970` | — | `projects` |
| Quotes | `0-14` | — | `quotes` |
| Services | `0-162` | ✓ | `services` |
| Taxes | `0-86` | — | `taxes` |
| Tickets | `0-5` | ✓ | `tickets` |
| Users | `0-115` | — | `users` |

> **Custom objects** (`2-XXX`): fetched from `GET /crm/v3/schemas?archived=false`. The "Objects" and "Schemas" API entries in the user's list refer to the generic objects API and the schemas API respectively — the audit handles these automatically.

## What the script collects

### 1. Object usage check
For every object type, the audit calls `GET /crm/v3/objects/{objectType}?limit=1` to determine if the object is actually in use. Objects with no records are flagged as **not in use** in the report. Use `SKIP_UNUSED=1` to skip property collection for empty objects.

### 2. Custom object schemas
`GET /crm/v3/schemas?archived=false` returns all custom object definitions including their labels, properties, and association configurations. Note: this endpoint only returns custom object schemas, not native objects.

### 3. Properties for each object
`GET /crm/v3/properties/{objectType}?archived=false` returns all properties including:
- `name` / `label` — API name and display label
- `type` / `fieldType` — data type and UI field type (see valid combinations below)
- `hasUniqueValue` — **true** if this property is configured as a unique identifier
- `hubspotDefined` — **true** for HubSpot-managed system properties
- `description` — documentation string for the property
- `groupName` — which property group it belongs to
- `createdAt` / `updatedAt` — when the property was created/last changed

**Property type and fieldType combinations** (most common):
| `type` | Valid `fieldType` values |
|--------|------------------------|
| `string` | `text`, `textarea`, `phonenumber`, `html` |
| `number` | `number` |
| `date` | `date` |
| `datetime` | `date` |
| `enumeration` | `select`, `radio`, `checkbox`, `booleancheckbox` |
| `bool` | `booleancheckbox` |

### 4. Unique identifiers
Properties with `hasUniqueValue: true` are unique identifier properties — they enforce uniqueness across all records of that object type. Built-in unique identifiers include:
- Contacts: `hs_object_id` (Record ID), `email`
- Companies: `hs_object_id`, `domain`
- All objects: `hs_object_id` (always the primary identifier)

Custom unique identifier properties are flagged in the audit with guidance on ensuring values are always populated.

### 5. Pipelines
For objects that support pipelines, the audit calls `GET /crm/v3/pipelines/{objectType}` and collects:
- Pipeline name, ID, and display order
- Stage names, IDs, and order
- Stage metadata (probability for deals, ticketState for tickets)

Pipeline-enabled objects: **Deals**, **Tickets**, **Appointments**, **Courses**, **Listings**, **Orders**, **Services**, **Leads** (Sales Hub Pro+), **Custom objects** (Enterprise)

### 6. Association types
`GET /crm/v4/associations/{from}/{to}/types` for key object pairs, returning typed association labels including custom association types.

### 7. Property validations
`GET /crm/v3/property-validations/{objectTypeId}` returns validation rules for properties on an object. Validation rules constrain the format or values that can be stored in a property (e.g., regex patterns, length limits, number ranges).

### 8. CRM limits
The audit calls all limits tracking endpoints to build a complete picture of usage vs. limits:

| Endpoint | What it returns |
|----------|-----------------|
| `GET /crm/v3/limits/records` | Record counts and limits per object |
| `GET /crm/v3/limits/custom-properties` | Custom property counts per object |
| `GET /crm/v3/limits/calculated-properties` | Calculated property usage (Pro/Enterprise) |
| `GET /crm/v3/limits/pipelines` | Pipeline count vs. limit per object |
| `GET /crm/v3/limits/custom-object-types` | Custom object schema count (Enterprise) |
| `GET /crm/v3/limits/associations/labels` | Association label usage (Pro/Enterprise) |
| `GET /crm/v3/limits/associations/records/from` | Which objects have records near association limits |

## What the audit detects

| Severity | Issue |
|----------|-------|
| **Critical** | Exact duplicate labels on the same object |
| **Warning** | Highly similar labels (possible duplicates) |
| **Warning** | Custom properties missing a description |
| **Info** | Custom unique identifier property (visibility) |
| **Info** | Same label on multiple objects (cross-object duplicates) |
| **Info** | Naming convention inconsistencies within an object |

## Outputs

- **`audit-data.json`** — raw data (objects, usage, properties, pipelines, associations, limits, validations, findings)
- **`audit-report.html`** — HTML report with:
  - Summary stat cards (object count, total properties, pipelines, critical issues)
  - Object inventory table with **in-use status**, pipeline count, unique identifier count
  - Pipelines section (per-object pipeline and stage breakdown)
  - CRM Limits dashboard (record limits, property limits, pipeline limits — % used)
  - Property Validations section
  - Three Mermaid.js ERD tabs: Full Model, Contact-Centric, Deal Pipeline
  - Filterable findings table
  - Recommended cleanup order
  - Link to HubSpot Data Model Viewer

Open the report: `open audit-report.html` (macOS) or `start audit-report.html` (Windows)

## After the audit

When reviewing findings with the user:

1. **Object usage** — Identify objects that are configured but have no records. These may represent unused HubSpot features or objects that need data migration.
2. **Critical findings first** — Exact duplicate properties actively harm data quality. Determine the "source of truth" property and delete or merge the other.
3. **Unique identifiers** — Review custom unique identifier properties. Ensure values are always populated on import and integration writes, or deduplication will fail.
4. **Pipeline review** — For pipeline-enabled objects, check stage counts and probability values (for deals). Pipelines with too many stages or unclear closed states are common issues.
5. **Limits awareness** — If any object is using >80% of its record, property, or pipeline limits, plan accordingly before hitting walls.
6. **Property validations** — Review validation rules on critical properties. Missing validations on important fields (like phone format, email format) can lead to data quality issues.
7. **Missing descriptions** — Help write concise descriptions for custom properties without them.
8. **Naming inconsistencies** — Recommend a `snake_case` naming convention for all custom property API names.

## Troubleshooting

- **401 Unauthorized**: Token is invalid or expired. Ask the user to regenerate their Private App token.
- **403 Forbidden on an object**: Token lacks the required scope for that object. The audit skips it and notes the access failure.
- **Object skipped (not found)**: Some objects (partner clients, partner services) may not be available in all portals. These are gracefully skipped.
- **No pipelines returned**: The object may not have any pipelines configured, or the object doesn't support pipelines in the current HubSpot tier.
- **Limits endpoint returns null**: Some limits (calculated properties, association labels, custom objects) require Professional or Enterprise tier.
- **CLI not found**: Script automatically falls back to REST API — this is expected and fine.
