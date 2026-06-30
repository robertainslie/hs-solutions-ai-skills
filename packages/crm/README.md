# @hs-skills/crm

CRM domain skills for HubSpot AI automation.

## Skills

### [CRM Schema Audit](skills/crm-schema-audit)

Collects the full HubSpot CRM data model and runs AI-powered analysis to surface:
- Duplicate or similar properties across and within objects
- Properties missing descriptions
- Naming convention inconsistencies
- Redundant custom properties that shadow native ones

Generates an HTML report with Mermaid.js ERD diagrams and links to the HubSpot Data Model Viewer.

**Auth required:** `HUBSPOT_ACCESS_TOKEN` (Private App with `crm.schemas.read`)

```bash
HUBSPOT_ACCESS_TOKEN=pat-na1-... node skills/crm-schema-audit/src/audit.js
```
