# /audit — Run CRM Schema Audit

Runs the HubSpot CRM Schema Audit script and opens the generated HTML report.

## Usage

```
/audit
/audit --output ./reports
/audit --portal 12345678
```

## What This Does

1. Verifies `HUBSPOT_ACCESS_TOKEN` is set (prompts if missing)
2. Optionally checks for the HubSpot CLI
3. Runs `audit.js` to collect schema data and generate findings
4. Opens `audit-report.html` in the default browser
5. Summarizes the top findings in the conversation

## Steps

When the user invokes `/audit`:

1. Check for `HUBSPOT_ACCESS_TOKEN` in the environment. If missing:
   ```
   To run the audit, you'll need a HubSpot Private App token.
   
   1. Go to HubSpot Settings → Integrations → Private Apps
   2. Create a new Private App with these scopes:
      - crm.schemas.read
      - crm.objects.schemas.read
   3. Copy the token and run:
      export HUBSPOT_ACCESS_TOKEN=pat-na1-your-token
   
   Then run /audit again.
   ```

2. Parse any flags from the command:
   - `--output <dir>` → set `OUTPUT_DIR`
   - `--portal <id>` → set `HUBSPOT_PORTAL_ID`

3. Run the audit script:
   ```bash
   HUBSPOT_ACCESS_TOKEN=$HUBSPOT_ACCESS_TOKEN \
   HUBSPOT_PORTAL_ID=$HUBSPOT_PORTAL_ID \
   OUTPUT_DIR=<output_dir> \
   node packages/crm/skills/crm-schema-audit/src/audit.js
   ```

4. On success, open the report:
   ```bash
   open audit-report.html  # macOS
   # or: start audit-report.html  # Windows
   ```

5. Read `audit-data.json` and summarize:
   - Total objects and properties found
   - Number of critical / warning / info findings
   - Top 3 most impactful findings with recommendations
   - Prompt: "Would you like to walk through the findings together?"
