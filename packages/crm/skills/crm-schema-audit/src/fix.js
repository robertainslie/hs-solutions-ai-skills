#!/usr/bin/env node
/**
 * HubSpot CRM Schema Fix
 *
 * Reads fix-plan.json produced by audit.js and executes fixes interactively.
 *
 * Usage:
 *   node fix.js                          Dry run — shows what would happen (default)
 *   node fix.js --execute                Interactive mode — prompts before each fix group
 *   node fix.js --item FIX-001 --execute Execute a single fix by ID (used by Claude)
 *   node fix.js --item FIX-003 --dest-pipeline <id> --execute  Pipeline-with-records fix
 *   node fix.js --plan ./path.json       Use a specific fix-plan.json file
 *   node fix.js --no-backup              Skip data backup before destructive operations
 *
 * Required: HUBSPOT_ACCESS_TOKEN with read + write scopes
 *   Additional write scopes needed: crm.schemas.{object}.write, crm.objects.{object}.write
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const readline = require('readline');

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const args = process.argv.slice(2);
const DRY_RUN = !args.includes('--execute');

const planArg = args.indexOf('--plan');
const PLAN_PATH = planArg !== -1 ? args[planArg + 1] : path.join(process.cwd(), 'fix-plan.json');
const LOG_PATH = path.join(path.dirname(PLAN_PATH), 'fix-log.json');
const BACKUP_DIR = path.dirname(PLAN_PATH);

// Single-item mode — used by Claude to execute one fix at a time
const itemArg = args.indexOf('--item');
const ITEM_ID = itemArg !== -1 ? args[itemArg + 1] : null;
const ITEM_MODE = !!ITEM_ID;

// Destination pipeline for archive-pipeline-with-records in --item mode
const destArg = args.indexOf('--dest-pipeline');
const DEST_PIPELINE_ID = destArg !== -1 ? args[destArg + 1] : null;

// Backup is on by default when executing (off in dry run, can be disabled explicitly)
const BACKUP = !DRY_RUN && !args.includes('--no-backup');

if (!TOKEN) {
  console.error('Error: HUBSPOT_ACCESS_TOKEN is not set.');
  process.exit(1);
}

const log = [];

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function apiRequest(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.hubapi.com',
      path: apiPath,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(data ? JSON.parse(data) : {}); } catch { resolve({}); }
        } else {
          const err = new Error(`HTTP ${res.statusCode} from ${method} ${apiPath}: ${data.slice(0, 200)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const apiGet  = (p)    => apiRequest('GET', p);
const apiPost = (p, b) => apiRequest('POST', p, b);
const apiDel  = (p)    => apiRequest('DELETE', p);

// ─── Prompt ───────────────────────────────────────────────────────────────────

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

async function confirm(question, defaultYes = true) {
  if (DRY_RUN || ITEM_MODE) return true; // dry run / item mode always confirms
  const hint = defaultYes ? '[Y/n]' : '[y/N]';
  const answer = (await ask(`${question} ${hint} `)).trim().toLowerCase();
  if (answer === '') return defaultYes;
  return answer === 'y' || answer === 'yes';
}

async function choose(question, options) {
  console.log(question);
  options.forEach((o, i) => console.log(`  ${i + 1}) ${o}`));
  if (DRY_RUN || ITEM_MODE) { console.log('  [DRY RUN / ITEM MODE] Would prompt for choice'); return 0; }
  const answer = await ask('Enter number: ');
  const idx = parseInt(answer, 10) - 1;
  return idx >= 0 && idx < options.length ? idx : 0;
}

// ─── Backup ───────────────────────────────────────────────────────────────────

async function backupBeforeFix(fix) {
  if (!BACKUP) return;
  const backupPath = path.join(BACKUP_DIR, `backup-${fix.id}.json`);
  let backupData = { fixId: fix.id, type: fix.type, objectName: fix.objectName, backedUpAt: new Date().toISOString() };

  try {
    if (fix.type === 'archive-empty-duplicate') {
      // Backup the property definition before archiving
      const def = await apiGet(`/crm/v3/properties/${fix.objectName}/${fix.propertyToArchive}`);
      backupData.propertyDefinition = def;

    } else if (fix.type === 'archive-pipeline' || fix.type === 'archive-pipeline-with-records') {
      // Backup the full pipeline definition
      const resp = await apiGet(`/crm/v3/pipelines/${fix.objectName}/${fix.pipelineId}`);
      backupData.pipelineDefinition = resp;

    } else if (fix.type === 'migrate-and-archive') {
      // Backup all records with values in the source property (up to 10,000)
      const records = [];
      let after;
      do {
        const resp = await apiPost(`/crm/v3/objects/${fix.objectName}/search`, {
          filterGroups: [{ filters: [{ propertyName: fix.sourceProperty, operator: 'HAS_PROPERTY' }] }],
          properties: ['hs_object_id', fix.sourceProperty, fix.canonicalProperty],
          limit: 100,
          ...(after ? { after } : {}),
        });
        records.push(...(resp.results || []).map((r) => ({
          id: r.id,
          [fix.sourceProperty]: r.properties[fix.sourceProperty],
          [fix.canonicalProperty]: r.properties[fix.canonicalProperty],
        })));
        after = resp.paging?.next?.after;
      } while (after && records.length < 10000);
      backupData.sourceProperty = fix.sourceProperty;
      backupData.canonicalProperty = fix.canonicalProperty;
      backupData.recordCount = records.length;
      backupData.records = records;
      if (records.length === 10000) backupData.note = 'Capped at 10,000 records';
    }

    fs.writeFileSync(backupPath, JSON.stringify(backupData, null, 2));
    console.log(`    Backup written: ${backupPath}`);
  } catch (e) {
    console.warn(`    Warning: backup failed (${e.message}). Proceeding without backup.`);
  }
}

// ─── Core fix operations ──────────────────────────────────────────────────────

function recordLog(action, details, dryRun) {
  log.push({ timestamp: new Date().toISOString(), action, dryRun, ...details });
}

async function archiveProperty(objectName, propertyName) {
  if (DRY_RUN) {
    console.log(`    [DRY RUN] Would archive property ${objectName}.${propertyName}`);
    recordLog('archive-property', { objectName, propertyName }, true);
    return;
  }
  await apiDel(`/crm/v3/properties/${objectName}/${propertyName}`);
  console.log(`    ✓ Archived property ${objectName}.${propertyName}`);
  recordLog('archive-property', { objectName, propertyName }, false);
}

async function archivePipeline(objectName, pipelineId, pipelineName) {
  if (DRY_RUN) {
    console.log(`    [DRY RUN] Would archive pipeline "${pipelineName}" (${pipelineId}) on ${objectName}`);
    recordLog('archive-pipeline', { objectName, pipelineId, pipelineName }, true);
    return;
  }
  await apiDel(`/crm/v3/pipelines/${objectName}/${pipelineId}`);
  console.log(`    ✓ Archived pipeline "${pipelineName}"`);
  recordLog('archive-pipeline', { objectName, pipelineId, pipelineName }, false);
}

async function migrateAndArchiveProperty(objectName, sourceProperty, canonicalProperty) {
  let after;
  let totalMigrated = 0;

  // Get total count first
  const countResp = await apiPost(`/crm/v3/objects/${objectName}/search`, {
    filterGroups: [{ filters: [{ propertyName: sourceProperty, operator: 'HAS_PROPERTY' }] }],
    properties: ['hs_object_id'],
    limit: 1,
  });
  const total = countResp.total || 0;

  if (total === 0) {
    console.log(`    No records with values in "${sourceProperty}" — skipping migration, archiving directly.`);
  } else {
    console.log(`    Migrating ${total.toLocaleString()} records: ${sourceProperty} → ${canonicalProperty}`);
    if (DRY_RUN) {
      console.log(`    [DRY RUN] Would migrate ${total.toLocaleString()} records in batches of 100, then archive "${sourceProperty}"`);
      recordLog('migrate-property', { objectName, sourceProperty, canonicalProperty, total }, true);
    } else {
      let page = 0;
      do {
        const searchResp = await apiPost(`/crm/v3/objects/${objectName}/search`, {
          filterGroups: [{ filters: [{ propertyName: sourceProperty, operator: 'HAS_PROPERTY' }] }],
          properties: ['hs_object_id', sourceProperty, canonicalProperty],
          limit: 100,
          ...(after ? { after } : {}),
        });

        const records = searchResp.results || [];
        if (!records.length) break;

        // Only copy where canonical is not already populated
        const toUpdate = records
          .filter((r) => r.properties[sourceProperty] && !r.properties[canonicalProperty])
          .map((r) => ({ id: r.id, properties: { [canonicalProperty]: r.properties[sourceProperty] } }));

        if (toUpdate.length > 0) {
          await apiPost(`/crm/v3/objects/${objectName}/batch/update`, { inputs: toUpdate });
          totalMigrated += toUpdate.length;
        }

        page++;
        const pct = Math.min(Math.round((page * 100) / Math.ceil(total / 100)), 100);
        process.stdout.write(`\r    Progress: ${totalMigrated.toLocaleString()} migrated  [${pct}%]   `);

        after = searchResp.paging?.next?.after;
      } while (after);

      process.stdout.write('\n');
      console.log(`    ✓ Migrated ${totalMigrated.toLocaleString()} records to "${canonicalProperty}"`);
      recordLog('migrate-property', { objectName, sourceProperty, canonicalProperty, total, totalMigrated }, false);
    }
  }

  // Archive the source property
  await archiveProperty(objectName, sourceProperty);
}

// ─── Single-item execution (for Claude-guided flow) ───────────────────────────

async function executeSingleItem(fix, allFixes) {
  const result = { fixId: fix.id, type: fix.type, object: fix.objectName, dryRun: DRY_RUN };
  try {
    console.log(`\nExecuting ${fix.id}: ${fix.reason}\n`);

    await backupBeforeFix(fix);

    if (fix.type === 'archive-empty-duplicate') {
      await archiveProperty(fix.objectName, fix.propertyToArchive);
      result.status = 'success';
      result.message = `Archived property "${fix.propertyToArchive}" on ${fix.objectLabel}`;

    } else if (fix.type === 'archive-pipeline') {
      await archivePipeline(fix.objectName, fix.pipelineId, fix.pipelineName);
      result.status = 'success';
      result.message = `Archived pipeline "${fix.pipelineName}" on ${fix.objectLabel}`;

    } else if (fix.type === 'migrate-and-archive') {
      await migrateAndArchiveProperty(fix.objectName, fix.sourceProperty, fix.canonicalProperty);
      result.status = 'success';
      result.message = `Migrated "${fix.sourceProperty}" → "${fix.canonicalProperty}" and archived source on ${fix.objectLabel}`;

    } else if (fix.type === 'archive-pipeline-with-records') {
      if (!DEST_PIPELINE_ID) {
        result.status = 'error';
        result.message = `archive-pipeline-with-records requires --dest-pipeline <pipelineId>. Fetch available pipelines with: node -e "const https=require('https');const req=https.request({hostname:'api.hubapi.com',path:'/crm/v3/pipelines/${fix.objectName}',headers:{Authorization:'Bearer '+process.env.HUBSPOT_ACCESS_TOKEN}},res=>{let d='';res.on('data',c=>d+=c);res.on('end',()=>console.log(JSON.parse(d).results.map(p=>p.id+' '+p.label).join('\\n')))});req.end()"`;
        console.error(result.message);
        return result;
      }
      // Fetch destination pipeline
      const resp = await apiGet(`/crm/v3/pipelines/${fix.objectName}`);
      const dest = (resp.results || []).find((p) => p.id === DEST_PIPELINE_ID);
      if (!dest) {
        result.status = 'error';
        result.message = `Destination pipeline "${DEST_PIPELINE_ID}" not found on ${fix.objectName}`;
        return result;
      }
      const destFirstStage = (dest.stages || []).sort((a, b) => a.displayOrder - b.displayOrder)[0];
      const prop = fix.objectName === 'deals' ? 'pipeline' : 'hs_pipeline';
      const stageMap = { [prop]: dest.id };
      if (destFirstStage) {
        stageMap[fix.objectName === 'deals' ? 'dealstage' : 'hs_pipeline_stage'] = destFirstStage.id;
      }

      if (DRY_RUN) {
        console.log(`    [DRY RUN] Would move ${fix.recordCount.toLocaleString()} records to "${dest.label}", then archive "${fix.pipelineName}"`);
        result.status = 'dry-run';
        result.message = `Would move ${fix.recordCount} records to "${dest.label}" and archive "${fix.pipelineName}"`;
      } else {
        let after;
        let moved = 0;
        const srcProp = fix.objectName === 'deals' ? 'pipeline' : 'hs_pipeline';
        do {
          const searchResp = await apiPost(`/crm/v3/objects/${fix.objectName}/search`, {
            filterGroups: [{ filters: [{ propertyName: srcProp, operator: 'EQ', value: fix.pipelineId }] }],
            properties: ['hs_object_id'],
            limit: 100,
            ...(after ? { after } : {}),
          });
          const records = searchResp.results || [];
          if (!records.length) break;
          const inputs = records.map((r) => ({ id: r.id, properties: stageMap }));
          await apiPost(`/crm/v3/objects/${fix.objectName}/batch/update`, { inputs });
          moved += inputs.length;
          process.stdout.write(`\r    Moved: ${moved.toLocaleString()}/${fix.recordCount.toLocaleString()}`);
          after = searchResp.paging?.next?.after;
        } while (after);
        process.stdout.write('\n');
        recordLog('move-pipeline-records', { objectName: fix.objectName, fromPipeline: fix.pipelineId, toPipeline: dest.id, moved }, false);
        await archivePipeline(fix.objectName, fix.pipelineId, fix.pipelineName);
        result.status = 'success';
        result.message = `Moved ${moved} records to "${dest.label}" and archived "${fix.pipelineName}"`;
      }

    } else if (fix.type === 'review-duplicate') {
      result.status = 'skipped';
      result.message = `Tier 3 fix — manual review required for "${fix.propertyA}" vs "${fix.propertyB}" on ${fix.objectLabel}`;

    } else {
      result.status = 'error';
      result.message = `Unknown fix type: ${fix.type}`;
    }
  } catch (e) {
    result.status = 'error';
    result.message = e.message;
    console.error(`  ✗ Failed: ${e.message}`);
    recordLog('error', { fixId: fix.id, error: e.message }, DRY_RUN);
  }
  return result;
}

// ─── Fix groups (interactive mode) ───────────────────────────────────────────

async function runTier1(fixes) {
  const items = fixes.filter((f) => f.tier === 1);
  if (!items.length) { console.log('\nNo Tier 1 fixes found.'); return; }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`TIER 1 — Auto-fixable (${items.length} items, no data risk)`);
  console.log('─'.repeat(60));
  items.forEach((f, i) => console.log(`  ${i + 1}. [${f.type}] ${f.objectLabel}: ${f.reason}`));

  if (!await confirm('\nApply all Tier 1 fixes?')) {
    console.log('  Skipped Tier 1.');
    return;
  }

  for (const fix of items) {
    console.log(`\n  → ${fix.id}: ${fix.reason}`);
    try {
      await backupBeforeFix(fix);
      if (fix.type === 'archive-empty-duplicate') {
        await archiveProperty(fix.objectName, fix.propertyToArchive);
      } else if (fix.type === 'archive-pipeline') {
        await archivePipeline(fix.objectName, fix.pipelineId, fix.pipelineName);
      }
    } catch (e) {
      console.error(`    ✗ Failed: ${e.message}`);
      recordLog('error', { fixId: fix.id, error: e.message }, DRY_RUN);
    }
  }
}

async function runTier2(fixes) {
  const items = fixes.filter((f) => f.tier === 2);
  if (!items.length) { console.log('\nNo Tier 2 fixes found.'); return; }

  console.log(`\n${'─'.repeat(60)}`);
  console.log(`TIER 2 — Needs confirmation (${items.length} items)`);
  console.log('─'.repeat(60));

  for (const fix of items) {
    console.log(`\n  ${fix.id} [${fix.type}] ${fix.objectLabel}`);
    console.log(`  ${fix.reason}`);

    if (fix.type === 'migrate-and-archive') {
      console.log(`\n    Suggested canonical: "${fix.canonicalProperty}" (${(fix.canonicalValueCount || 0).toLocaleString()} records)`);
      console.log(`    Source to migrate:   "${fix.sourceProperty}" (${(fix.sourceValueCount || 0).toLocaleString()} records)`);

      const choice = await choose('  Which property should be the canonical (kept)?', [
        `${fix.canonicalProperty} — ${fix.canonicalPropertyLabel} (${(fix.canonicalValueCount || 0).toLocaleString()} records) [suggested]`,
        `${fix.sourceProperty} — ${fix.sourcePropertyLabel} (${(fix.sourceValueCount || 0).toLocaleString()} records)`,
        'Skip this fix',
      ]);

      if (choice === 2) { console.log('  Skipped.'); continue; }

      const canonical = choice === 0 ? fix.canonicalProperty : fix.sourceProperty;
      const source    = choice === 0 ? fix.sourceProperty    : fix.canonicalProperty;

      if (!await confirm(`  Migrate "${source}" → "${canonical}" then archive "${source}"?`)) {
        console.log('  Skipped.');
        continue;
      }

      try {
        await backupBeforeFix({ ...fix, sourceProperty: source, canonicalProperty: canonical });
        await migrateAndArchiveProperty(fix.objectName, source, canonical);
      } catch (e) {
        console.error(`    ✗ Failed: ${e.message}`);
        recordLog('error', { fixId: fix.id, error: e.message }, DRY_RUN);
      }

    } else if (fix.type === 'archive-pipeline-with-records') {
      console.log(`    This pipeline has ${fix.recordCount.toLocaleString()} records.`);
      console.log(`    You must move those records to another pipeline before archiving.`);

      let otherPipelines = [];
      try {
        const resp = await apiGet(`/crm/v3/pipelines/${fix.objectName}`);
        otherPipelines = (resp.results || []).filter((p) => p.id !== fix.pipelineId);
      } catch { /* ignore */ }

      if (otherPipelines.length === 0) {
        console.log(`    No other pipelines available to move records to. Skipping.`);
        continue;
      }

      if (!await confirm(`  Proceed with moving ${fix.recordCount.toLocaleString()} records then archiving "${fix.pipelineName}"?`, false)) {
        console.log('  Skipped.');
        continue;
      }

      const destIdx = await choose('  Move records to which pipeline?', otherPipelines.map((p) => p.label));
      const dest = otherPipelines[destIdx];

      if (!DRY_RUN) {
        try {
          const destFirstStage = (dest.stages || []).sort((a, b) => a.displayOrder - b.displayOrder)[0];
          const prop = fix.objectName === 'deals' ? 'pipeline' : 'hs_pipeline';
          const stageMap = { [prop]: dest.id };
          if (destFirstStage) {
            stageMap[fix.objectName === 'deals' ? 'dealstage' : 'hs_pipeline_stage'] = destFirstStage.id;
          }

          let after;
          let moved = 0;
          const srcProp = fix.objectName === 'deals' ? 'pipeline' : 'hs_pipeline';
          do {
            const searchResp = await apiPost(`/crm/v3/objects/${fix.objectName}/search`, {
              filterGroups: [{ filters: [{ propertyName: srcProp, operator: 'EQ', value: fix.pipelineId }] }],
              properties: ['hs_object_id'],
              limit: 100,
              ...(after ? { after } : {}),
            });
            const records = searchResp.results || [];
            if (!records.length) break;
            const inputs = records.map((r) => ({ id: r.id, properties: stageMap }));
            await apiPost(`/crm/v3/objects/${fix.objectName}/batch/update`, { inputs });
            moved += inputs.length;
            process.stdout.write(`\r    Moved: ${moved.toLocaleString()}/${fix.recordCount.toLocaleString()}`);
            after = searchResp.paging?.next?.after;
          } while (after);
          process.stdout.write('\n');
          console.log(`    ✓ Moved ${moved.toLocaleString()} records to "${dest.label}"`);
          recordLog('move-pipeline-records', { objectName: fix.objectName, fromPipeline: fix.pipelineId, toPipeline: dest.id, moved }, false);
          await backupBeforeFix(fix);
          await archivePipeline(fix.objectName, fix.pipelineId, fix.pipelineName);
        } catch (e) {
          console.error(`    ✗ Failed: ${e.message}`);
          recordLog('error', { fixId: fix.id, error: e.message }, DRY_RUN);
        }
      } else {
        console.log(`    [DRY RUN] Would move ${fix.recordCount.toLocaleString()} records to "${dest.label}", then archive "${fix.pipelineName}"`);
        recordLog('archive-pipeline-with-records', { objectName: fix.objectName, pipelineId: fix.pipelineId, recordCount: fix.recordCount, destination: dest.label }, true);
      }
    }
  }
}

function showTier3(fixes) {
  const items = fixes.filter((f) => f.tier === 3);
  if (!items.length) return;
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`TIER 3 — Manual review required (${items.length} items)`);
  console.log('─'.repeat(60));
  items.forEach((f, i) => {
    console.log(`\n  ${i + 1}. [${f.objectLabel}] ${f.reason}`);
    if (f.propertyA) console.log(`     Properties: ${f.propertyA} / ${f.propertyB}`);
  });
  console.log('\n  These require human judgment — no automation available.');
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!ITEM_MODE) {
    console.log('HubSpot CRM Schema Fix');
    console.log('======================');
    console.log(DRY_RUN ? 'Mode: DRY RUN (run with --execute to apply fixes)\n' : 'Mode: EXECUTE\n');
  }

  if (!fs.existsSync(PLAN_PATH)) {
    console.error(`Error: fix-plan.json not found at ${PLAN_PATH}`);
    console.error('Run audit.js first to generate it.');
    process.exit(1);
  }

  const plan = JSON.parse(fs.readFileSync(PLAN_PATH, 'utf-8'));
  const fixes = plan.fixes || [];

  // ── Single-item mode (used by Claude) ──
  if (ITEM_MODE) {
    const fix = fixes.find((f) => f.id === ITEM_ID);
    if (!fix) {
      const result = { fixId: ITEM_ID, status: 'error', message: `Fix "${ITEM_ID}" not found in plan. Available: ${fixes.map((f) => f.id).join(', ')}` };
      console.log(JSON.stringify(result));
      rl.close();
      process.exit(1);
    }

    const result = await executeSingleItem(fix, fixes);

    // Write log
    if (log.length > 0) {
      const logData = fs.existsSync(LOG_PATH) ? JSON.parse(fs.readFileSync(LOG_PATH, 'utf-8')) : { actions: [] };
      logData.actions.push(...log);
      logData.lastRunAt = new Date().toISOString();
      fs.writeFileSync(LOG_PATH, JSON.stringify(logData, null, 2));
    }

    // Structured output for Claude to parse
    console.log(JSON.stringify(result));
    rl.close();
    return;
  }

  // ── Interactive mode ──
  console.log(`Fix plan from: ${plan.generatedAt}`);
  console.log(`Portal: ${plan.portalId || 'unknown'}`);
  console.log(`Total fixes: ${fixes.length} (${fixes.filter((f) => f.tier === 1).length} auto, ${fixes.filter((f) => f.tier === 2).length} confirm, ${fixes.filter((f) => f.tier === 3).length} manual)`);
  if (BACKUP) console.log('Backups: enabled (data will be saved before each destructive operation)');

  if (!plan.checkValuesRun) {
    console.log('\nNote: audit was run without CHECK_VALUES=1 — property duplicate fixes are Tier 3 (manual).');
    console.log('Re-run audit with CHECK_VALUES=1 for Tier 1/2 property fixes.\n');
  }

  if (fixes.length === 0) {
    console.log('\nNo fixes in plan. Run audit.js first.');
    rl.close();
    return;
  }

  await runTier1(fixes);
  await runTier2(fixes);
  showTier3(fixes);

  // Write log
  if (log.length > 0) {
    fs.writeFileSync(LOG_PATH, JSON.stringify({ runAt: new Date().toISOString(), dryRun: DRY_RUN, actions: log }, null, 2));
    console.log(`\nLog written to: ${LOG_PATH}`);
  }

  console.log(DRY_RUN ? '\nDry run complete. Run with --execute to apply.' : '\nDone. Re-run audit.js to verify changes.');
  rl.close();
}

main().catch((err) => {
  if (ITEM_MODE) {
    console.log(JSON.stringify({ fixId: ITEM_ID, status: 'error', message: err.message }));
  } else {
    console.error('\nFix failed:', err.message);
  }
  rl.close();
  process.exit(1);
});
