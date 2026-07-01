#!/usr/bin/env node
/**
 * HubSpot CRM Schema Audit
 *
 * Collects a complete CRM picture: all 30+ native object types, custom objects,
 * usage (record sampling), properties, pipelines, association types, property
 * validations, and limits. Generates an HTML report with ERD diagrams.
 *
 * Required:  HUBSPOT_ACCESS_TOKEN (Private App token)
 * Optional:  HUBSPOT_PORTAL_ID   (for Data Model Viewer link)
 * Optional:  OUTPUT_DIR          (default: cwd)
 * Optional:  SKIP_UNUSED=1       (skip property collection for empty objects)
 */

const { execSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
let PORTAL_ID = process.env.HUBSPOT_PORTAL_ID || '';
const OUTPUT_DIR = process.env.OUTPUT_DIR || process.cwd();
const SKIP_UNUSED = process.env.SKIP_UNUSED === '1';
const CHECK_VALUES = process.env.CHECK_VALUES === '1'; // opt-in: count records per property for fix plan
const AUDIT_WORKFLOWS = process.env.AUDIT_WORKFLOWS !== '0'; // on by default; set to 0 to skip

// All native CRM object types.
// name: API path segment used in /crm/v3/objects/{name} and /crm/v3/properties/{name}
// objectTypeId: numeric ID used in property-validations and limits APIs
// hasPipelines: true if this object supports the pipelines API
const NATIVE_OBJECTS = [
  { name: 'contacts',            objectTypeId: '0-1',   label: 'Contacts',               hasPipelines: false },
  { name: 'companies',           objectTypeId: '0-2',   label: 'Companies',              hasPipelines: false },
  { name: 'deals',               objectTypeId: '0-3',   label: 'Deals',                  hasPipelines: true  },
  { name: 'tickets',             objectTypeId: '0-5',   label: 'Tickets',                hasPipelines: true  },
  { name: 'products',            objectTypeId: '0-7',   label: 'Products',               hasPipelines: false },
  { name: 'line_items',          objectTypeId: '0-8',   label: 'Line Items',             hasPipelines: false },
  { name: 'quotes',              objectTypeId: '0-14',  label: 'Quotes',                 hasPipelines: false },
  { name: 'communications',      objectTypeId: '0-18',  label: 'Communications',         hasPipelines: false },
  { name: 'feedback_submissions',objectTypeId: '0-19',  label: 'Feedback Submissions',   hasPipelines: false },
  { name: 'invoices',            objectTypeId: '0-53',  label: 'Invoices',               hasPipelines: false },
  { name: '0-69',                objectTypeId: '0-69',  label: 'Commerce Subscriptions', hasPipelines: false },
  { name: 'goals',               objectTypeId: '0-74',  label: 'Goals',                  hasPipelines: false },
  { name: 'discounts',           objectTypeId: '0-84',  label: 'Discounts',              hasPipelines: false },
  { name: 'fees',                objectTypeId: '0-85',  label: 'Fees',                   hasPipelines: false },
  { name: 'taxes',               objectTypeId: '0-86',  label: 'Taxes',                  hasPipelines: false },
  { name: '0-101',               objectTypeId: '0-101', label: 'Commerce Payments',      hasPipelines: false },
  { name: 'users',               objectTypeId: '0-115', label: 'Users',                  hasPipelines: false },
  { name: 'orders',              objectTypeId: '0-123', label: 'Orders',                 hasPipelines: true  },
  { name: 'leads',               objectTypeId: '0-136', label: 'Leads',                  hasPipelines: true  },
  { name: 'carts',               objectTypeId: '0-142', label: 'Carts',                  hasPipelines: false },
  { name: 'services',            objectTypeId: '0-162', label: 'Services',               hasPipelines: true  },
  { name: 'courses',             objectTypeId: '0-410', label: 'Courses',                hasPipelines: true  },
  { name: 'listings',            objectTypeId: '0-420', label: 'Listings',               hasPipelines: true  },
  { name: 'appointments',        objectTypeId: '0-421', label: 'Appointments',           hasPipelines: true  },
  { name: 'partner-clients',     objectTypeId: null,    label: 'Partner Clients',        hasPipelines: false },
  { name: 'partner-services',    objectTypeId: null,    label: 'Partner Services',       hasPipelines: false },
  { name: 'projects',            objectTypeId: '0-970', label: 'Projects',               hasPipelines: false },
];


// ─── Utilities ───────────────────────────────────────────────────────────────

function apiGet(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.hubapi.com',
      path: apiPath,
      method: 'GET',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); }
          catch (e) { reject(new Error(`Failed to parse response from ${apiPath}`)); }
        } else {
          const err = new Error(`HTTP ${res.statusCode} from ${apiPath}: ${data.slice(0, 150)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function cliAvailable() {
  try { execSync('hubspot --version', { stdio: 'ignore' }); return true; }
  catch { return false; }
}

function apiPost(apiPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const options = {
      hostname: 'api.hubapi.com',
      path: apiPath,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve(JSON.parse(data)); } catch { resolve({}); }
        } else {
          const err = new Error(`HTTP ${res.statusCode} from ${apiPath}: ${data.slice(0, 150)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

function apiDelete(apiPath) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.hubapi.com',
      path: apiPath,
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}` },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(true);
        else {
          const err = new Error(`HTTP ${res.statusCode} from ${apiPath}: ${data.slice(0, 150)}`);
          err.statusCode = res.statusCode;
          reject(err);
        }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

function runCli(args) {
  const result = spawnSync('hubspot', args, { encoding: 'utf-8', timeout: 30000 });
  if (result.status !== 0) throw new Error(`hubspot ${args.join(' ')} failed: ${result.stderr}`);
  return result.stdout;
}

// ─── Environment Validation ───────────────────────────────────────────────────

async function validateEnvironment() {
  // 1. Token present
  if (!TOKEN) {
    console.error('Error: HUBSPOT_ACCESS_TOKEN is not set.');
    console.error('Generate a Private App token in HubSpot Settings → Integrations → Private Apps.');
    console.error('Then run: export HUBSPOT_ACCESS_TOKEN=pat-na1-...');
    process.exit(1);
  }

  // 2. HubSpot CLI
  const hasCli = cliAvailable();
  console.log(`HubSpot CLI:   ${hasCli ? 'installed' : 'not found (REST-only mode)'}`);

  // 3. Validate token + resolve portal ID from account info
  let accountInfo;
  try {
    accountInfo = await apiGet('/account-info/v3/details');
  } catch (e) {
    if (e.statusCode === 401) {
      console.error('\nError: HUBSPOT_ACCESS_TOKEN is invalid or expired (401).');
      console.error('Regenerate your Private App token and try again.');
      process.exit(1);
    }
    console.warn(`Warning: Could not verify token via account-info API (${e.message}). Continuing anyway.`);
    accountInfo = null;
  }

  const resolvedPortalId = accountInfo ? String(accountInfo.portalId) : null;
  const region = accountInfo ? (accountInfo.dataHostingLocation || 'na1') : 'na1';

  if (resolvedPortalId) {
    console.log(`Token valid:   portal ${resolvedPortalId} (${region})`);
  }

  // 4. Check portal ID match if user supplied one
  if (PORTAL_ID && resolvedPortalId && PORTAL_ID !== resolvedPortalId) {
    console.warn(`\nWarning: HUBSPOT_PORTAL_ID=${PORTAL_ID} does not match the token's portal (${resolvedPortalId}).`);
    console.warn('The report link and any portal-specific context may be incorrect.');
    console.warn('Using token portal ID instead.\n');
    PORTAL_ID = resolvedPortalId;
  }

  // Auto-fill portal ID if not provided
  if (!PORTAL_ID && resolvedPortalId) {
    PORTAL_ID = resolvedPortalId;
    console.log(`Portal ID:     auto-detected as ${PORTAL_ID}`);
  }

  return { hasCli, accountInfo };
}

// ─── Data Collection ─────────────────────────────────────────────────────────

async function getCustomSchemas(useCli) {
  if (useCli) {
    try {
      const output = runCli(['schemas', 'list', '--format', 'json']);
      const parsed = JSON.parse(output);
      return Array.isArray(parsed) ? parsed : (parsed.results || []);
    } catch (e) {
      console.warn('  CLI schemas list failed, using REST API');
    }
  }
  try {
    const resp = await apiGet('/crm/v3/schemas?archived=false');
    return resp.results || [];
  } catch (e) {
    console.warn(`  Warning: Could not fetch custom schemas (${e.message})`);
    return [];
  }
}

async function checkObjectInUse(objectName) {
  try {
    const resp = await apiGet(`/crm/v3/objects/${objectName}?limit=1&properties=hs_object_id`);
    const hasMore = !!(resp.paging && resp.paging.next);
    const count = resp.results ? resp.results.length : 0;
    return { inUse: count > 0 || hasMore, accessible: true };
  } catch (e) {
    if (e.statusCode === 404 || e.statusCode === 400) {
      return { inUse: false, accessible: false, notFound: true };
    }
    if (e.statusCode === 403) {
      return { inUse: null, accessible: false, noAccess: true };
    }
    return { inUse: null, accessible: false };
  }
}

async function getPropertiesForType(objectName) {
  try {
    const resp = await apiGet(`/crm/v3/properties/${objectName}?archived=false`);
    return resp.results || [];
  } catch {
    return null; // null = inaccessible or not found
  }
}

async function getPipelinesForObject(objectName) {
  try {
    const resp = await apiGet(`/crm/v3/pipelines/${objectName}`);
    return (resp.results || []).map((p) => ({
      id: p.id,
      label: p.label,
      displayOrder: p.displayOrder,
      stages: (p.stages || []).sort((a, b) => a.displayOrder - b.displayOrder).map((s) => ({
        id: s.id,
        label: s.label,
        displayOrder: s.displayOrder,
        metadata: s.metadata || {},
      })),
    }));
  } catch {
    return [];
  }
}

async function getAssociationTypes(fromType, toType) {
  try {
    const resp = await apiGet(`/crm/v4/associations/${fromType}/${toType}/labels`);
    return (resp.results || []).map((t) => ({
      fromType, toType,
      typeId: t.typeId,
      label: t.label || (t.category === 'HUBSPOT_DEFINED' ? `${fromType} → ${toType}` : `Custom (${t.typeId})`),
      category: t.category,
    }));
  } catch {
    return [];
  }
}

async function getPropertyValidations(objectTypeId) {
  if (!objectTypeId) return [];
  try {
    const resp = await apiGet(`/crm/v3/property-validations/${objectTypeId}`);
    return resp.results || [];
  } catch {
    return [];
  }
}

async function getLimitsData() {
  const limits = {};
  const endpoints = [
    ['records',             '/crm/v3/limits/records'],
    ['customProperties',    '/crm/v3/limits/custom-properties'],
    ['calculatedProperties','/crm/v3/limits/calculated-properties'],
    ['pipelines',           '/crm/v3/limits/pipelines'],
    ['customObjectTypes',   '/crm/v3/limits/custom-object-types'],
    ['associationLabels',   '/crm/v3/limits/association-labels'],
    ['associationRecords',  '/crm/v3/limits/associations/records/from'],
  ];
  for (const [key, endpoint] of endpoints) {
    try { limits[key] = await apiGet(endpoint); }
    catch { limits[key] = null; }
  }
  return limits;
}

// ─── Workflows ───────────────────────────────────────────────────────────────

const ACTION_TYPE_LABELS = {
  '0-1': 'Delay (time)', '0-2': 'Go to action', '0-3': 'Create task',
  '0-4': 'Send email', '0-5': 'Set property', '0-14': 'Create record',
  '0-18': 'Rotate leads', '0-19': 'Send internal notification',
  '0-20': 'Salesforce campaign', '0-23': 'Format data',
  '0-28': 'Send SMS / communication', '0-33': 'Enrollment action',
  '0-35': 'Delay (until date)', '0-63809083': 'Add to list',
  'LIST_BRANCH': 'Branch (list)', 'STATIC_BRANCH': 'Branch (static)',
  'WEBHOOK': 'Webhook', 'CUSTOM_CODE': 'Custom code',
};

const JUNK_NAME_PATTERN = /^(test\s*\d*|new workflow|unnamed.*|asdf.*|jlk.*|adsf.*|untitled.*|draft.*|copy of.*|wip\s*\d*|temp\s*\d*)$/i;

async function getWorkflows() {
  const summaries = [];
  let after;
  try {
    do {
      const resp = await apiGet(`/automation/v4/flows?limit=50${after ? `&after=${after}` : ''}`);
      summaries.push(...(resp.results || []));
      after = resp.paging?.next?.after;
    } while (after);
  } catch (e) {
    if (e.statusCode === 403) { console.warn('  No access to workflows (add automation scope)'); return []; }
    console.warn(`  Warning: could not fetch workflows (${e.message})`);
    return [];
  }

  // Fetch full detail for each (needed for actions, enrollmentCriteria)
  const details = [];
  for (const s of summaries) {
    try {
      details.push(await apiGet(`/automation/v4/flows/${s.id}`));
    } catch { details.push(s); } // fall back to summary
  }
  return details;
}

function analyzeWorkflows(workflows) {
  const findings = [];
  const now = new Date();
  const ninetyDaysAgo = new Date(now - 90 * 24 * 60 * 60 * 1000);

  for (const wf of workflows) {
    const name = wf.name || '';
    const enabled = wf.isEnabled;
    const actions = wf.actions || [];
    const enrollment = wf.enrollmentCriteria || {};
    const updatedAt = wf.updatedAt ? new Date(wf.updatedAt) : null;
    const createdAt = wf.createdAt ? new Date(wf.createdAt) : null;
    const neverEdited = createdAt && updatedAt && Math.abs(updatedAt - createdAt) < 5000;

    // 0-action workflows — broken/incomplete
    if (actions.length === 0) {
      findings.push({
        severity: 'critical', workflowId: wf.id, workflowName: name,
        objectTypeId: wf.objectTypeId, isEnabled: enabled,
        issue: 'No actions configured',
        recommendation: enabled ? `"${name}" is enabled but has no actions — it enrolls records and does nothing. Disable or delete it.` : `"${name}" has no actions — likely an abandoned draft. Delete it.`,
      });
    }

    // Junk/test names
    if (JUNK_NAME_PATTERN.test(name.trim())) {
      findings.push({
        severity: 'critical', workflowId: wf.id, workflowName: name,
        objectTypeId: wf.objectTypeId, isEnabled: enabled,
        issue: 'Test or placeholder name',
        recommendation: `"${name}" appears to be a test or draft workflow. ${enabled ? 'Disable and delete it.' : 'Delete it.'}`,
      });
    }

    // Never-edited and disabled
    if (!enabled && neverEdited) {
      findings.push({
        severity: 'warning', workflowId: wf.id, workflowName: name,
        objectTypeId: wf.objectTypeId, isEnabled: enabled,
        issue: 'Disabled, never edited (likely abandoned draft)',
        recommendation: `"${name}" was created but never modified. Delete if not needed.`,
      });
    }

    // Manual-enrollment — only fires if someone manually enrolls; may be intentional but worth flagging
    if (enrollment.type === 'MANUAL' && !enabled) {
      findings.push({
        severity: 'info', workflowId: wf.id, workflowName: name,
        objectTypeId: wf.objectTypeId, isEnabled: enabled,
        issue: 'Manual enrollment, disabled',
        recommendation: `"${name}" requires manual enrollment to trigger and is disabled. Confirm it's still needed.`,
      });
    }

    // Re-enrollment enabled on active workflows — can cause repeated sends
    if (enabled && enrollment.shouldReEnroll) {
      const hasEmail = actions.some((a) => a.actionTypeId === '0-4');
      if (hasEmail) {
        findings.push({
          severity: 'warning', workflowId: wf.id, workflowName: name,
          objectTypeId: wf.objectTypeId, isEnabled: enabled,
          issue: 'Re-enrollment enabled on email-sending workflow',
          recommendation: `"${name}" can re-enroll contacts and sends email — verify this is intentional to avoid duplicate sends.`,
        });
      }
    }

    // Webhook actions — external dependency, should be documented
    const hasWebhook = actions.some((a) => a.type === 'WEBHOOK');
    if (hasWebhook && enabled) {
      findings.push({
        severity: 'info', workflowId: wf.id, workflowName: name,
        objectTypeId: wf.objectTypeId, isEnabled: enabled,
        issue: 'Webhook action in active workflow',
        recommendation: `"${name}" calls an external webhook. Ensure the endpoint is monitored and documented.`,
      });
    }

    // Custom code — maintenance risk
    const hasCustomCode = actions.some((a) => a.type === 'CUSTOM_CODE');
    if (hasCustomCode && enabled) {
      findings.push({
        severity: 'info', workflowId: wf.id, workflowName: name,
        objectTypeId: wf.objectTypeId, isEnabled: enabled,
        issue: 'Custom code action in active workflow',
        recommendation: `"${name}" uses custom code. Ensure it is version-controlled and tested.`,
      });
    }
  }

  // Duplicate names across all workflows
  const nameCounts = {};
  for (const wf of workflows) {
    const n = (wf.name || '').trim().toLowerCase();
    nameCounts[n] = (nameCounts[n] || []).concat(wf.id);
  }
  for (const [name, ids] of Object.entries(nameCounts)) {
    if (ids.length > 1 && !JUNK_NAME_PATTERN.test(name)) {
      findings.push({
        severity: 'warning', workflowId: ids.join(', '), workflowName: name,
        objectTypeId: '—', isEnabled: '—',
        issue: `Duplicate workflow name (${ids.length} workflows)`,
        recommendation: `${ids.length} workflows share the name "${name}". Rename them to distinguish their purpose.`,
      });
    }
  }

  return findings;
}

// ─── Fix Plan ────────────────────────────────────────────────────────────────

async function checkPropertyValueCount(objectName, propertyName) {
  try {
    const resp = await apiPost(`/crm/v3/objects/${objectName}/search`, {
      filterGroups: [{ filters: [{ propertyName, operator: 'HAS_PROPERTY' }] }],
      properties: ['hs_object_id'],
      limit: 1,
    });
    return resp.total != null ? resp.total : null;
  } catch { return null; }
}

async function getPipelineRecordCount(objectName, pipelineId) {
  const prop = objectName === 'deals' ? 'pipeline' : 'hs_pipeline';
  try {
    const resp = await apiPost(`/crm/v3/objects/${objectName}/search`, {
      filterGroups: [{ filters: [{ propertyName: prop, operator: 'EQ', value: pipelineId }] }],
      properties: ['hs_object_id'],
      limit: 1,
    });
    return resp.total != null ? resp.total : null;
  } catch { return null; }
}

async function buildFixPlan(objects, findings, pipelines, pipelineRecordCounts) {
  const fixes = [];
  let seq = 0;
  const nextId = () => `FIX-${String(++seq).padStart(3, '0')}`;

  // --- Exact duplicate property pairs (critical findings) ---
  for (const finding of findings.filter((f) => f.severity === 'critical')) {
    const parts = (finding.propertyName || '').split(' / ');
    if (parts.length !== 2) continue;
    const [propA, propB] = parts;
    const obj = objects.find((o) => o.name === finding.objectName);
    if (!obj) continue;
    const propADef = (obj.properties || []).find((p) => p.name === propA);
    const propBDef = (obj.properties || []).find((p) => p.name === propB);

    let countA = null, countB = null;
    if (CHECK_VALUES) {
      process.stdout.write(`  Checking values: ${obj.name}.${propA} / ${propB}...`);
      [countA, countB] = await Promise.all([
        checkPropertyValueCount(obj.name, propA),
        checkPropertyValueCount(obj.name, propB),
      ]);
      console.log(` ${countA ?? '?'} / ${countB ?? '?'}`);
    }

    if (!CHECK_VALUES) {
      fixes.push({
        id: nextId(), tier: 3, type: 'review-duplicate', automatable: false,
        objectName: obj.name, objectLabel: obj.label, objectTypeId: obj.objectTypeId,
        propertyA: propA, propertyLabelA: propADef?.label || propA,
        propertyB: propB, propertyLabelB: propBDef?.label || propB,
        reason: `Exact duplicate label — re-run with CHECK_VALUES=1 to check value counts and unlock auto-fix.`,
      });
    } else if ((countA || 0) === 0 && (countB || 0) === 0) {
      const toArchive = propADef?.hubspotDefined ? propB : propA;
      const toKeep = toArchive === propA ? propB : propA;
      fixes.push({
        id: nextId(), tier: 1, type: 'archive-empty-duplicate', automatable: true,
        objectName: obj.name, objectLabel: obj.label, objectTypeId: obj.objectTypeId,
        propertyToArchive: toArchive,
        propertyToArchiveLabel: (toArchive === propA ? propADef : propBDef)?.label || toArchive,
        canonicalProperty: toKeep,
        canonicalPropertyLabel: (toKeep === propA ? propADef : propBDef)?.label || toKeep,
        sourceValueCount: 0, canonicalValueCount: 0,
        reason: `Both properties have 0 records with values. Archive "${toArchive}" — no data migration needed.`,
      });
    } else if ((countA || 0) === 0 || (countB || 0) === 0) {
      const emptyIsA = (countA || 0) === 0;
      const toArchive = emptyIsA ? propA : propB;
      const toKeep = emptyIsA ? propB : propA;
      const keepCount = emptyIsA ? countB : countA;
      fixes.push({
        id: nextId(), tier: 1, type: 'archive-empty-duplicate', automatable: true,
        objectName: obj.name, objectLabel: obj.label, objectTypeId: obj.objectTypeId,
        propertyToArchive: toArchive,
        propertyToArchiveLabel: (emptyIsA ? propADef : propBDef)?.label || toArchive,
        canonicalProperty: toKeep,
        canonicalPropertyLabel: (emptyIsA ? propBDef : propADef)?.label || toKeep,
        sourceValueCount: 0, canonicalValueCount: keepCount,
        reason: `"${toArchive}" has 0 records with values. Archive it — "${toKeep}" is canonical with ${(keepCount || 0).toLocaleString()} records.`,
      });
    } else {
      // Both have values — migration required, suggest the higher-count one as canonical
      const aWins = (countA || 0) >= (countB || 0);
      const canonical = aWins ? propA : propB;
      const source = aWins ? propB : propA;
      const canonicalDef = aWins ? propADef : propBDef;
      const sourceDef = aWins ? propBDef : propADef;
      const sourceCount = aWins ? countB : countA;
      const canonicalCount = aWins ? countA : countB;
      fixes.push({
        id: nextId(), tier: 2, type: 'migrate-and-archive', automatable: true, requiresConfirmation: true,
        objectName: obj.name, objectLabel: obj.label, objectTypeId: obj.objectTypeId,
        sourceProperty: source, sourcePropertyLabel: sourceDef?.label || source, sourceValueCount: sourceCount,
        canonicalProperty: canonical, canonicalPropertyLabel: canonicalDef?.label || canonical, canonicalValueCount: canonicalCount,
        reason: `Both have values. Suggested canonical: "${canonical}" (${(canonicalCount || 0).toLocaleString()} records). Migrate ${(sourceCount || 0).toLocaleString()} records from "${source}", then archive it. Confirm before executing.`,
      });
    }
  }

  // --- Pipelines ---
  for (const [objName, psList] of Object.entries(pipelines)) {
    const obj = objects.find((o) => o.name === objName);
    for (const pipeline of psList) {
      const recordCount = pipelineRecordCounts[`${objName}:${pipeline.id}`];
      if (recordCount === 0) {
        fixes.push({
          id: nextId(), tier: 1, type: 'archive-pipeline', automatable: true,
          objectName: objName, objectLabel: obj?.label || objName,
          pipelineId: pipeline.id, pipelineName: pipeline.label,
          stageCount: pipeline.stages.length, recordCount: 0,
          reason: `"${pipeline.label}" has 0 records across all ${pipeline.stages.length} stages — safe to archive.`,
        });
      } else if (recordCount != null && recordCount > 0) {
        fixes.push({
          id: nextId(), tier: 2, type: 'archive-pipeline-with-records', automatable: false,
          objectName: objName, objectLabel: obj?.label || objName,
          pipelineId: pipeline.id, pipelineName: pipeline.label,
          stageCount: pipeline.stages.length, recordCount,
          reason: `"${pipeline.label}" has ${recordCount.toLocaleString()} records. Move all records to another pipeline first, then archive.`,
        });
      }
    }
  }

  fixes.sort((a, b) => a.tier - b.tier || a.type.localeCompare(b.type) || a.objectName.localeCompare(b.objectName));
  return fixes;
}

// ─── Analysis ────────────────────────────────────────────────────────────────

function normalizeLabel(str) {
  return str.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function jaroWinkler(s1, s2) {
  if (s1 === s2) return 1;
  const len1 = s1.length, len2 = s2.length;
  const matchDist = Math.max(Math.floor(Math.max(len1, len2) / 2) - 1, 0);
  const s1m = new Array(len1).fill(false), s2m = new Array(len2).fill(false);
  let matches = 0, transpositions = 0;
  for (let i = 0; i < len1; i++) {
    for (let j = Math.max(0, i - matchDist); j < Math.min(i + matchDist + 1, len2); j++) {
      if (s2m[j] || s1[i] !== s2[j]) continue;
      s1m[i] = s2m[j] = true; matches++; break;
    }
  }
  if (matches === 0) return 0;
  let k = 0;
  for (let i = 0; i < len1; i++) {
    if (!s1m[i]) continue;
    while (!s2m[k]) k++;
    if (s1[i] !== s2[k]) transpositions++;
    k++;
  }
  const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
  let prefix = 0;
  for (let i = 0; i < Math.min(4, Math.min(len1, len2)); i++) {
    if (s1[i] === s2[i]) prefix++; else break;
  }
  return jaro + prefix * 0.1 * (1 - jaro);
}

function detectNamingConvention(name) {
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)*$/.test(name)) return 'snake_case';
  if (/^[a-z][a-zA-Z0-9]*$/.test(name)) return 'camelCase';
  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase';
  if (/\s/.test(name)) return 'with_spaces';
  return 'mixed';
}

function analyzeProperties(allObjects) {
  const findings = [];
  const allProps = [];
  for (const obj of allObjects) {
    for (const prop of (obj.properties || [])) {
      allProps.push({ ...prop, objectName: obj.name, objectLabel: obj.label });
    }
  }

  // Flag custom unique identifier properties for visibility
  for (const p of allProps) {
    if (p.hasUniqueValue && !p.hubspotDefined) {
      findings.push({
        severity: 'info',
        objectName: p.objectName,
        propertyName: p.name,
        propertyLabel: p.label,
        issue: 'Custom unique identifier property',
        recommendation: `"${p.label}" enforces uniqueness on ${p.objectLabel}. Ensure all integrations and imports always populate this field, otherwise records won't deduplicate correctly.`,
      });
    }
  }

  // Missing descriptions on custom properties
  for (const p of allProps) {
    if (p.hubspotDefined) continue;
    if (!p.description || !p.description.trim()) {
      findings.push({
        severity: 'warning',
        objectName: p.objectName,
        propertyName: p.name,
        propertyLabel: p.label,
        issue: 'Missing description',
        recommendation: `Add a description to "${p.label}" so team members understand its purpose.`,
      });
    }
  }

  // Exact and near-duplicate labels within the same object
  for (const obj of allObjects) {
    const props = (obj.properties || []).filter((p) => !p.hubspotDefined);
    for (let i = 0; i < props.length; i++) {
      for (let j = i + 1; j < props.length; j++) {
        const a = normalizeLabel(props[i].label || props[i].name);
        const b = normalizeLabel(props[j].label || props[j].name);
        if (a === b) {
          findings.push({
            severity: 'critical',
            objectName: obj.name,
            propertyName: `${props[i].name} / ${props[j].name}`,
            propertyLabel: `${props[i].label} / ${props[j].label}`,
            issue: 'Exact duplicate label on same object',
            recommendation: `"${props[i].label}" and "${props[j].label}" on ${obj.label} have identical labels. Delete or merge one.`,
          });
        } else if (jaroWinkler(a, b) > 0.92) {
          findings.push({
            severity: 'warning',
            objectName: obj.name,
            propertyName: `${props[i].name} / ${props[j].name}`,
            propertyLabel: `${props[i].label} / ${props[j].label}`,
            issue: 'Similar labels (possible duplicate)',
            recommendation: `"${props[i].label}" and "${props[j].label}" on ${obj.label} may be duplicates. Verify they serve distinct purposes.`,
          });
        }
      }
    }
  }

  // Same label on multiple objects (cross-object duplicates)
  const customProps = allProps.filter((p) => !p.hubspotDefined);
  for (let i = 0; i < customProps.length; i++) {
    for (let j = i + 1; j < customProps.length; j++) {
      if (customProps[i].objectName === customProps[j].objectName) continue;
      const a = normalizeLabel(customProps[i].label || customProps[i].name);
      const b = normalizeLabel(customProps[j].label || customProps[j].name);
      if (a === b && a.length > 3) {
        findings.push({
          severity: 'info',
          objectName: `${customProps[i].objectName} + ${customProps[j].objectName}`,
          propertyName: `${customProps[i].name} / ${customProps[j].name}`,
          propertyLabel: `${customProps[i].label} / ${customProps[j].label}`,
          issue: 'Same label on multiple objects',
          recommendation: `"${customProps[i].label}" exists on both ${customProps[i].objectName} and ${customProps[j].objectName}. Verify this is intentional.`,
        });
      }
    }
  }

  // Naming convention inconsistencies within an object
  for (const obj of allObjects) {
    const props = (obj.properties || []).filter((p) => !p.hubspotDefined);
    if (props.length < 3) continue;
    const conventions = {};
    for (const p of props) { const c = detectNamingConvention(p.name); conventions[c] = (conventions[c] || 0) + 1; }
    const dominant = Object.entries(conventions).sort((a, b) => b[1] - a[1])[0][0];
    for (const p of props) {
      const c = detectNamingConvention(p.name);
      if (c !== dominant && dominant === 'snake_case') {
        findings.push({
          severity: 'info',
          objectName: obj.name,
          propertyName: p.name,
          propertyLabel: p.label,
          issue: `Naming convention mismatch (${c} vs predominant ${dominant})`,
          recommendation: `Rename "${p.name}" to follow the ${dominant} convention used by other properties on ${obj.label}.`,
        });
      }
    }
  }

  return findings;
}

// ─── ERD Generation ──────────────────────────────────────────────────────────

function sanitizeName(name) {
  const upper = name.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
  // Mermaid entity names must start with a letter
  return /^[A-Z]/.test(upper) ? upper : 'OBJ_' + upper;
}

function buildMermaidERD(objects, associations, filter) {
  const filtered = filter ? objects.filter(filter) : objects;
  const objNames = new Set(filtered.map((o) => o.name));
  let diagram = 'erDiagram\n';
  for (const obj of filtered) {
    const safe = sanitizeName(obj.name);
    const keyProps = (obj.properties || [])
      .filter((p) => p.name.startsWith('hs_') || ['name', 'email', 'firstname', 'lastname', 'domain', 'dealname', 'subject', 'content'].includes(p.name))
      .slice(0, 5);
    diagram += `  ${safe} {\n`;
    for (const p of keyProps) {
      const ft = (p.type || 'string').replace(/[^a-zA-Z]/g, '');
      diagram += `    ${ft} ${p.name.replace(/[^a-zA-Z0-9_]/g, '_')}\n`;
    }
    diagram += '  }\n';
  }
  const seen = new Set();
  for (const assoc of associations) {
    if (!objNames.has(assoc.fromType) || !objNames.has(assoc.toType)) continue;
    const key = `${assoc.fromType}-${assoc.toType}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const lbl = (assoc.label || '').replace(/"/g, '').slice(0, 30);
    diagram += `  ${sanitizeName(assoc.fromType)} }o--o{ ${sanitizeName(assoc.toType)} : "${lbl}"\n`;
  }
  return diagram;
}

// ─── HTML Report ─────────────────────────────────────────────────────────────

function pct(value) {
  if (value == null) return '—';
  const n = parseFloat(value);
  return isNaN(n) ? '—' : `${n.toFixed(1)}%`;
}

function limitBar(percentage) {
  if (percentage == null) return '';
  const n = Math.min(parseFloat(percentage) || 0, 100);
  const color = n >= 90 ? '#c0392b' : n >= 70 ? '#e67e22' : '#27ae60';
  return `<div style="background:#eee;border-radius:3px;height:8px;width:120px;display:inline-block;vertical-align:middle;margin-left:6px"><div style="background:${color};height:8px;border-radius:3px;width:${n}%"></div></div>`;
}

function generateHtml(data, findings) {
  const { objects, associations, pipelines, limits, validations, fixPlan, workflows, workflowFindings } = data;
  const criticalCount = findings.filter((f) => f.severity === 'critical').length;
  const warningCount = findings.filter((f) => f.severity === 'warning').length;
  const infoCount = findings.filter((f) => f.severity === 'info').length;
  const totalProps = objects.reduce((s, o) => s + (o.properties || []).length, 0);
  const customProps = objects.reduce((s, o) => s + (o.properties || []).filter((p) => !p.hubspotDefined).length, 0);
  const inUseObjects = objects.filter((o) => o.usage && o.usage.inUse).length;
  const totalPipelines = Object.values(pipelines || {}).reduce((s, ps) => s + ps.length, 0);

  const dataModelUrl = PORTAL_ID
    ? `https://app.hubspot.com/contacts/${PORTAL_ID}/objects/data-model-overview`
    : 'https://app.hubspot.com/l/data-model-overview/';
  const dqUrl = 'https://app.hubspot.com/l/data-quality/';
  const dqKbUrl = 'https://knowledge.hubspot.com/data-management/use-data-quality-tools';

  const contactCentric = ['contacts', 'companies', 'deals', 'tickets', 'leads', 'quotes', 'invoices'];
  const dealPipeline = ['deals', 'contacts', 'companies', 'line_items', 'quotes', 'tickets'];

  const erdFull = buildMermaidERD(objects, associations, null);
  const erdContacts = buildMermaidERD(objects, associations, (o) => contactCentric.includes(o.name));
  const erdDeals = buildMermaidERD(objects, associations, (o) => dealPipeline.includes(o.name));

  // Object inventory rows
  const objectRows = objects.map((o) => {
    const props = (o.properties || []);
    const customPropCount = props.filter((p) => !p.hubspotDefined).length;
    const uniqueIdCount = props.filter((p) => p.hasUniqueValue).length;
    const pipelineCount = (pipelines[o.name] || []).length;
    const isCustom = o.isCustom;
    const usage = o.usage || {};
    let usageBadge;
    if (usage.notFound) usageBadge = '<span class="badge badge-skip">Not Found</span>';
    else if (usage.noAccess) usageBadge = '<span class="badge badge-skip">No Access</span>';
    else if (usage.inUse) usageBadge = '<span class="badge badge-active">In Use</span>';
    else if (usage.accessible === false) usageBadge = '<span class="badge badge-skip">Skipped</span>';
    else usageBadge = '<span class="badge badge-empty">Empty</span>';
    const pipelinePart = pipelineCount > 0 ? `<span style="color:#2980b9;white-space:nowrap">${pipelineCount} pipeline${pipelineCount !== 1 ? 's' : ''}</span>` : '—';
    const uniquePart = uniqueIdCount > 0 ? `<span style="color:#8e44ad;white-space:nowrap">${uniqueIdCount} unique ID${uniqueIdCount !== 1 ? 's' : ''}</span>` : '—';
    return `<tr>
      <td><strong>${o.label || o.name}</strong></td>
      <td class="shrink"><code>${o.name}</code></td>
      <td class="shrink">${isCustom ? '<span class="badge badge-info">Custom</span>' : '<span class="badge badge-native">Native</span>'}</td>
      <td class="shrink">${usageBadge}</td>
      <td class="num">${props.length}</td>
      <td class="num">${customPropCount}</td>
      <td class="shrink">${uniquePart}</td>
      <td class="shrink">${pipelinePart}</td>
    </tr>`;
  }).join('');

  // Pipeline section HTML
  const pipelineEntries = Object.entries(pipelines || {})
    .filter(([, ps]) => ps.length > 0)
    .map(([objName, ps]) => {
      const obj = objects.find((o) => o.name === objName);
      const label = obj ? obj.label : objName;
      const pipelineRows = ps.map((p) => {
        const stageList = p.stages.map((s) => {
          const prob = s.metadata && s.metadata.probability !== undefined
            ? ` <small style="color:#888">(${Math.round(parseFloat(s.metadata.probability) * 100)}%)</small>`
            : '';
          return `<li>${s.label}${prob}</li>`;
        }).join('');
        return `<details style="margin-bottom:8px">
          <summary style="cursor:pointer;font-weight:500">${p.label} <small style="color:#888">(${p.stages.length} stages)</small></summary>
          <ul style="margin:6px 0 0 20px;padding:0;font-size:0.85rem">${stageList}</ul>
        </details>`;
      }).join('');
      return `<div style="margin-bottom:16px">
        <h4 style="margin:0 0 8px;color:#2d3e50">${label}</h4>
        ${pipelineRows}
      </div>`;
    }).join('');

  // Limits section HTML
  function limitsTableRows(items, labelFn) {
    if (!items || !items.length) return '<tr><td colspan="5" class="empty">No data available</td></tr>';
    return items.map((item) => {
      const p = parseFloat(item.percentage) || 0;
      const color = p >= 90 ? 'color:var(--critical)' : p >= 70 ? 'color:var(--warning)' : '';
      return `<tr>
        <td>${labelFn(item)}</td>
        <td class="num">${item.limit != null ? item.limit.toLocaleString() : '—'}</td>
        <td class="num">${item.usage != null ? item.usage.toLocaleString() : '—'}</td>
        <td class="num" style="${color}">${pct(item.percentage)}</td>
        <td class="bar-cell">${limitBar(item.percentage)}</td>
      </tr>`;
    }).join('');
  }

  const recordItems = [
    ...((limits.records && limits.records.hubspotDefinedObjectTypes) || []),
    ...((limits.records && limits.records.customObjectTypes && limits.records.customObjectTypes.byObjectType) || []),
  ];
  const recordRows = limitsTableRows(recordItems, (i) => `${i.singularLabel || i.objectTypeId}`);

  const propItems = (limits.customProperties && limits.customProperties.byObjectType) || [];
  const propRows = limitsTableRows(propItems, (i) => `${i.singularLabel || i.objectTypeId}`);

  const pipelineItems = [
    ...((limits.pipelines && limits.pipelines.hubspotDefinedObjectTypes) || []),
    ...((limits.pipelines && limits.pipelines.customObjectTypes && limits.pipelines.customObjectTypes.byObjectType) || []),
  ];
  const pipelineLimitRows = limitsTableRows(pipelineItems, (i) => `${i.singularLabel || i.objectTypeId}`);

  const overallProps = limits.customProperties;
  const overallCustomObjs = limits.customObjectTypes;

  // Property validations section
  const validationRows = (validations || []).map((v) => {
    return `<tr>
      <td><code>${v.objectTypeId || '—'}</code></td>
      <td><code>${v.propertyName || '—'}</code></td>
      <td>${v.ruleType || '—'}</td>
      <td>${v.blocksCreate ? '✓' : '—'}</td>
      <td>${v.blocksUpdate ? '✓' : '—'}</td>
    </tr>`;
  }).join('');

  // Findings rows
  const findingsRows = findings.map((f) => {
    const badge = {
      critical: '<span class="badge badge-critical">Critical</span>',
      warning: '<span class="badge badge-warning">Warning</span>',
      info: '<span class="badge badge-info">Info</span>',
    }[f.severity];
    return `<tr data-severity="${f.severity}" data-object="${f.objectName}">
      <td class="shrink">${badge}</td>
      <td class="shrink"><code>${f.objectName}</code></td>
      <td class="shrink"><code>${f.propertyName}</code></td>
      <td class="shrink">${f.issue}</td>
      <td class="grow">${f.recommendation}</td>
    </tr>`;
  }).join('');

  const cleanupSteps = [];
  if (criticalCount > 0) cleanupSteps.push(`<li><strong>Fix ${criticalCount} critical issue(s)</strong> — exact duplicate properties that create data confusion</li>`);
  if (warningCount > 0) cleanupSteps.push(`<li><strong>Review ${warningCount} warning(s)</strong> — similar properties and missing descriptions</li>`);
  if (infoCount > 0) cleanupSteps.push(`<li><strong>Investigate ${infoCount} informational finding(s)</strong> — unique identifiers, cross-object patterns, naming</li>`);
  cleanupSteps.push('<li>Add descriptions to all custom properties that lack them</li>');
  cleanupSteps.push('<li>Standardize property API names to snake_case within each object</li>');
  if (limits.records && parseFloat((limits.records.hubspotDefinedObjectTypes || [])[0]?.percentage) > 70) {
    cleanupSteps.push('<li>⚠️ Some objects are approaching record limits — review before large imports</li>');
  }
  cleanupSteps.push(`<li>Review the <a href="${dataModelUrl}" target="_blank">HubSpot Data Model Viewer</a> to visualize your full schema</li>`);

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HubSpot CRM Schema Audit</title>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>
  <style>
    :root {
      --hs-orange:#ff7a59;--hs-blue:#00a4bd;--hs-dark:#2d3e50;--hs-gray:#f5f8fa;
      --critical:#c0392b;--warning:#e67e22;--info:#2980b9;--native:#6c757d;
    }
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--hs-gray);color:var(--hs-dark)}
    header{background:var(--hs-dark);color:white;padding:1.5rem 2rem;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:1rem}
    header h1{font-size:1.4rem;font-weight:600}
    header .meta{font-size:.85rem;color:rgba(255,255,255,.7)}
    header a{color:var(--hs-orange);text-decoration:none;font-size:.9rem}
    main{max-width:1400px;margin:0 auto;padding:2rem}
    section{background:white;border-radius:8px;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 1px 4px rgba(0,0,0,.08)}
    h2{font-size:1.15rem;font-weight:600;margin-bottom:1rem;color:var(--hs-dark);border-bottom:2px solid var(--hs-gray);padding-bottom:.5rem}
    h3{font-size:1rem;font-weight:600;margin-bottom:.75rem}
    h4{font-size:.9rem}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
    .stat-card{background:var(--hs-gray);border-radius:6px;padding:1rem 1.25rem}
    .stat-card .number{font-size:2rem;font-weight:700}
    .stat-card .label{font-size:.8rem;color:#666;margin-top:2px}
    .stat-card.critical .number{color:var(--critical)}
    .stat-card.warning .number{color:var(--warning)}
    .stat-card.info .number{color:var(--info)}
    .stat-card.active .number{color:#27ae60}
    .tabs{display:flex;gap:.5rem;margin-bottom:1rem;flex-wrap:wrap}
    .tab{padding:.4rem 1rem;border-radius:20px;border:2px solid #ddd;background:white;cursor:pointer;font-size:.85rem;transition:all .15s}
    .tab.active{background:var(--hs-dark);color:white;border-color:var(--hs-dark)}
    .erd-panel{display:none;overflow-x:auto}
    .erd-panel.active{display:block}
    .erd-panel pre.mermaid{background:var(--hs-gray);border-radius:6px;padding:1rem}
    .filter-bar{display:flex;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center}
    .filter-bar label{font-size:.85rem;font-weight:500}
    .filter-bar select{padding:.3rem .6rem;border:1px solid #ddd;border-radius:4px;font-size:.85rem}
    .table-wrap{overflow-x:auto;-webkit-overflow-scrolling:touch}
    table{width:100%;border-collapse:collapse;font-size:.875rem;table-layout:auto}
    th{background:var(--hs-gray);padding:.5rem .75rem;text-align:left;font-weight:600;border-bottom:2px solid #e8e8e8;white-space:nowrap}
    td{padding:.5rem .75rem;border-bottom:1px solid #f0f0f0;vertical-align:top}
    td.shrink{width:1%;white-space:nowrap}
    td.num{width:1%;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums}
    td.grow{word-break:break-word;min-width:180px}
    th.shrink{width:1%}
    th.num{width:1%;text-align:right}
    tr:hover td{background:#fafbfc}
    tr[data-severity="critical"] td:first-child{border-left:3px solid var(--critical)}
    tr[data-severity="warning"] td:first-child{border-left:3px solid var(--warning)}
    tr[data-severity="info"] td:first-child{border-left:3px solid var(--info)}
    .badge{display:inline-block;padding:.2rem .5rem;border-radius:4px;font-size:.75rem;font-weight:600;white-space:nowrap}
    .badge-critical{background:#fdecea;color:var(--critical)}
    .badge-warning{background:#fef3e8;color:var(--warning)}
    .badge-info{background:#e8f4fb;color:var(--info)}
    .badge-native{background:#f0f0f0;color:var(--native)}
    .badge-active{background:#e8f8ed;color:#27ae60}
    .badge-empty{background:#fafafa;color:#999;border:1px solid #eee}
    .badge-skip{background:#fff3cd;color:#856404}
    code{font-family:'SF Mono',Consolas,monospace;font-size:.8rem;background:#f4f4f4;padding:.1rem .3rem;border-radius:3px;white-space:nowrap}
    ol{padding-left:1.25rem}
    ol li{margin-bottom:.5rem;line-height:1.5}
    a{color:var(--hs-blue)}
    .empty{color:#999;font-style:italic;text-align:center;padding:2rem}
    .limits-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:1.5rem;margin-bottom:1rem}
    .limits-card{border:1px solid #e8e8e8;border-radius:6px;padding:1rem;min-width:0}
    .limits-card h4{font-size:.9rem;margin-bottom:.75rem;color:#555}
    .limits-card table{width:100%}
    .bar-cell{width:140px;white-space:nowrap}
    details summary{cursor:pointer}
    details summary::-webkit-details-marker{color:var(--hs-blue)}
  </style>
</head>
<body>
  <header>
    <div>
      <h1>HubSpot CRM Schema Audit</h1>
      <div class="meta">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${PORTAL_ID ? ` · Portal ${PORTAL_ID}` : ''}</div>
    </div>
    <div style="display:flex;gap:1rem;flex-wrap:wrap">
      <a href="${dataModelUrl}" target="_blank">Data Model Viewer →</a>
      <a href="${dqUrl}" target="_blank">Data Quality Command Center →</a>
      <a href="${dqKbUrl}" target="_blank" style="color:rgba(255,255,255,.5);font-size:.8rem">DQ Tools guide ↗</a>
    </div>
  </header>
  <main>

    <section>
      <h2>Summary</h2>
      <div class="summary-grid">
        <div class="stat-card">
          <div class="number">${objects.length}</div>
          <div class="label">Object Types Audited</div>
        </div>
        <div class="stat-card active">
          <div class="number">${inUseObjects}</div>
          <div class="label">Objects In Use</div>
        </div>
        <div class="stat-card">
          <div class="number">${totalProps.toLocaleString()}</div>
          <div class="label">Total Properties</div>
        </div>
        <div class="stat-card">
          <div class="number">${customProps.toLocaleString()}</div>
          <div class="label">Custom Properties</div>
        </div>
        <div class="stat-card">
          <div class="number">${associations.length}</div>
          <div class="label">Association Types</div>
        </div>
        <div class="stat-card">
          <div class="number">${totalPipelines}</div>
          <div class="label">Pipelines</div>
        </div>
        <div class="stat-card critical">
          <div class="number">${criticalCount}</div>
          <div class="label">Critical Issues</div>
        </div>
        <div class="stat-card warning">
          <div class="number">${warningCount}</div>
          <div class="label">Warnings</div>
        </div>
        <div class="stat-card info">
          <div class="number">${infoCount}</div>
          <div class="label">Info Findings</div>
        </div>
        ${workflows ? `
        <div class="stat-card">
          <div class="number">${workflows.length}</div>
          <div class="label">Total Workflows</div>
        </div>
        <div class="stat-card active">
          <div class="number">${workflows.filter((w) => w.isEnabled).length}</div>
          <div class="label">Enabled Workflows</div>
        </div>` : ''}
      </div>
    </section>

    <section>
      <h2>Object Inventory</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr><th>Object</th><th class="shrink">Internal Name</th><th class="shrink">Type</th><th class="shrink">Usage</th><th class="num">Total Props</th><th class="num">Custom Props</th><th class="shrink">Unique IDs</th><th class="shrink">Pipelines</th></tr>
          </thead>
          <tbody>${objectRows || '<tr><td colspan="8" class="empty">No objects found</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    ${pipelineEntries ? `
    <section>
      <h2>Pipelines</h2>
      <p style="margin-bottom:1rem;font-size:.875rem;color:#555">Expand each pipeline to see its stages. Click to navigate.</p>
      <div style="columns:2;column-gap:2rem">${pipelineEntries}</div>
    </section>` : ''}

    <section>
      <h2>CRM Limits</h2>
      ${overallProps ? `<p style="font-size:.85rem;color:#555;margin-bottom:1rem">Overall custom property usage: <strong>${overallProps.overallUsage?.toLocaleString() || 0}</strong> / ${overallProps.overallLimit?.toLocaleString() || '?'} (${pct(overallProps.overallPercentage)})</p>` : ''}
      ${overallCustomObjs ? `<p style="font-size:.85rem;color:#555;margin-bottom:1rem">Custom object schemas: <strong>${overallCustomObjs.usage}</strong> / ${overallCustomObjs.limit} (${pct(overallCustomObjs.percentage)})</p>` : ''}
      <div class="limits-grid">
        <div class="limits-card">
          <h4>Record Limits</h4>
          <table>
            <thead><tr><th>Object</th><th class="num">Limit</th><th class="num">Used</th><th class="num">%</th><th class="bar-cell"></th></tr></thead>
            <tbody>${recordRows}</tbody>
          </table>
        </div>
        <div class="limits-card">
          <h4>Custom Property Limits (per object)</h4>
          <table>
            <thead><tr><th>Object</th><th class="num">Limit</th><th class="num">Used</th><th class="num">%</th><th class="bar-cell"></th></tr></thead>
            <tbody>${propRows}</tbody>
          </table>
        </div>
        <div class="limits-card">
          <h4>Pipeline Limits</h4>
          <table>
            <thead><tr><th>Object</th><th class="num">Limit</th><th class="num">Used</th><th class="num">%</th><th class="bar-cell"></th></tr></thead>
            <tbody>${pipelineLimitRows}</tbody>
          </table>
        </div>
      </div>
    </section>

    ${(validations && validations.length > 0) ? `
    <section>
      <h2>Property Validations (${validations.length} rules)</h2>
      <p style="font-size:.85rem;color:#555;margin-bottom:1rem">Properties with active validation rules that constrain how values can be entered.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="shrink">Object Type ID</th><th class="shrink">Property</th><th class="shrink">Rule Type</th><th class="shrink">Blocks Create</th><th class="shrink">Blocks Update</th></tr></thead>
          <tbody>${validationRows}</tbody>
        </table>
      </div>
    </section>` : ''}

    <section>
      <h2>Data Model ERDs</h2>
      <div class="tabs">
        <button class="tab active" onclick="showTab('full')">Full Model</button>
        <button class="tab" onclick="showTab('contacts')">Contact-Centric</button>
        <button class="tab" onclick="showTab('deals')">Deal Pipeline</button>
      </div>
      <div id="erd-full" class="erd-panel active"><pre class="mermaid">${erdFull}</pre></div>
      <div id="erd-contacts" class="erd-panel"><pre class="mermaid">${erdContacts}</pre></div>
      <div id="erd-deals" class="erd-panel"><pre class="mermaid">${erdDeals}</pre></div>
    </section>

    ${fixPlan && fixPlan.length > 0 ? (() => {
  const t1 = fixPlan.filter((f) => f.tier === 1);
  const t2 = fixPlan.filter((f) => f.tier === 2);
  const t3 = fixPlan.filter((f) => f.tier === 3);
  const typeLabel = { 'archive-empty-duplicate': 'Archive property', 'migrate-and-archive': 'Migrate → archive', 'archive-pipeline': 'Archive pipeline', 'archive-pipeline-with-records': 'Archive pipeline (has records)', 'review-duplicate': 'Review duplicate' };
  const fixRow = (f) => {
    const tierBadge = f.tier === 1 ? '<span class="badge badge-active">Tier 1</span>' : f.tier === 2 ? '<span class="badge badge-warning">Tier 2</span>' : '<span class="badge badge-skip">Tier 3</span>';
    const auto = f.automatable ? '<span style="color:#27ae60">✓ auto</span>' : '<span style="color:#999">manual</span>';
    const obj = `<code>${f.objectName}</code>`;
    return `<tr><td class="shrink">${tierBadge}</td><td class="shrink">${typeLabel[f.type] || f.type}</td><td class="shrink">${obj}</td><td class="grow">${f.reason}</td><td class="shrink">${auto}</td></tr>`;
  };
  return `<section>
      <h2>Fix Plan (${fixPlan.length} items)</h2>
      <p style="font-size:.875rem;color:#555;margin-bottom:1rem">
        Run <code>node fix.js --dry-run</code> to preview all fixes, then <code>node fix.js --execute</code> to apply interactively.
        ${data.checkValuesRun ? '' : ' Re-run audit with <code>CHECK_VALUES=1</code> to unlock Tier 1/2 property fixes.'}
      </p>
      <div style="display:flex;gap:1rem;margin-bottom:1rem;flex-wrap:wrap">
        <div class="stat-card active" style="flex:1;min-width:160px"><div class="number">${t1.length}</div><div class="label">Tier 1 — Auto-fixable</div></div>
        <div class="stat-card warning" style="flex:1;min-width:160px"><div class="number">${t2.length}</div><div class="label">Tier 2 — Needs confirmation</div></div>
        <div class="stat-card" style="flex:1;min-width:160px"><div class="number">${t3.length}</div><div class="label">Tier 3 — Manual review</div></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="shrink">Tier</th><th class="shrink">Action</th><th class="shrink">Object</th><th>Detail</th><th class="shrink">Automation</th></tr></thead>
          <tbody>${fixPlan.map(fixRow).join('')}</tbody>
        </table>
      </div>
    </section>`;
})() : ''}

    ${workflows && workflows.length > 0 ? (() => {
  const wfObjMap = {'0-1':'Contacts','0-2':'Companies','0-3':'Deals','0-5':'Tickets','0-421':'Appointments','0-136':'Leads','0-123':'Orders','0-162':'Services','0-410':'Courses','0-420':'Listings','0-74':'Goals','0-14':'Quotes','0-11':'Conversations'};
  const enrollTypeLabel = {'EVENT_BASED':'Event-based','LIST_BASED':'List-based','MANUAL':'Manual','DATASET':'Dataset'};
  const actionTypeCounts = {};
  for (const wf of workflows) {
    for (const a of (wf.actions || [])) {
      const k = ACTION_TYPE_LABELS[a.actionTypeId || a.type] || a.actionTypeId || a.type || 'Unknown';
      actionTypeCounts[k] = (actionTypeCounts[k] || 0) + 1;
    }
  }
  const enrollCounts = {};
  for (const wf of workflows) {
    const t = enrollTypeLabel[wf.enrollmentCriteria?.type] || wf.enrollmentCriteria?.type || 'Unknown';
    enrollCounts[t] = (enrollCounts[t] || 0) + 1;
  }
  const noActions = workflows.filter((w) => !(w.actions || []).length);
  const enabled = workflows.filter((w) => w.isEnabled);
  const wfFindingRows = (workflowFindings || []).map((f) => {
    const badge = f.severity === 'critical' ? '<span class="badge badge-critical">Critical</span>' : f.severity === 'warning' ? '<span class="badge badge-warning">Warning</span>' : '<span class="badge badge-info">Info</span>';
    const objLabel = wfObjMap[f.objectTypeId] || f.objectTypeId || '—';
    const enabledBadge = f.isEnabled === true ? '<span class="badge badge-active">On</span>' : f.isEnabled === false ? '<span class="badge badge-empty">Off</span>' : '—';
    return `<tr data-severity="${f.severity}"><td class="shrink">${badge}</td><td class="shrink">${enabledBadge}</td><td><a href="https://app.hubspot.com/workflows/${PORTAL_ID}/platform/flow/${f.workflowId}/edit" target="_blank">${f.workflowName}</a></td><td class="shrink">${objLabel}</td><td class="shrink">${f.issue}</td><td class="grow">${f.recommendation}</td></tr>`;
  }).join('');
  return `<section>
    <h2>Workflow Audit</h2>
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:1rem;margin-bottom:1.5rem">
      <div class="stat-card"><div class="number">${workflows.length}</div><div class="label">Total Workflows</div></div>
      <div class="stat-card active"><div class="number">${enabled.length}</div><div class="label">Enabled</div></div>
      <div class="stat-card"><div class="number">${workflows.length - enabled.length}</div><div class="label">Disabled</div></div>
      <div class="stat-card critical"><div class="number">${noActions.length}</div><div class="label">No Actions</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:1.5rem;margin-bottom:1.5rem">
      <div>
        <h3 style="margin-bottom:.5rem">By enrollment type</h3>
        <table><thead><tr><th>Type</th><th class="num">Count</th></tr></thead><tbody>
          ${Object.entries(enrollCounts).sort((a,b)=>b[1]-a[1]).map(([k,v])=>`<tr><td>${k}</td><td class="num">${v}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div>
        <h3 style="margin-bottom:.5rem">Action types in use</h3>
        <table><thead><tr><th>Action</th><th class="num">Count</th></tr></thead><tbody>
          ${Object.entries(actionTypeCounts).sort((a,b)=>b[1]-a[1]).slice(0,12).map(([k,v])=>`<tr><td>${k}</td><td class="num">${v}</td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>
    ${wfFindingRows ? `<h3 style="margin-bottom:.75rem">Workflow Findings (${(workflowFindings||[]).length})</h3>
    <div class="table-wrap"><table>
      <thead><tr><th class="shrink">Severity</th><th class="shrink">Status</th><th>Workflow</th><th class="shrink">Object</th><th class="shrink">Issue</th><th>Recommendation</th></tr></thead>
      <tbody>${wfFindingRows}</tbody>
    </table></div>` : '<p style="color:#999;font-style:italic">No workflow issues found.</p>'}
  </section>`;
})() : ''}

    <section>
      <h2>Audit Findings (${findings.length} total)</h2>
      <div class="filter-bar">
        <label>Severity:</label>
        <select onchange="filterFindings()">
          <option value="">All</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="info">Info</option>
        </select>
        <label>Object:</label>
        <select id="object-filter" onchange="filterFindings()">
          <option value="">All</option>
          ${objects.map((o) => `<option value="${o.name}">${o.label || o.name}</option>`).join('')}
        </select>
      </div>
      <div class="table-wrap">
        <table id="findings-table">
          <thead><tr><th class="shrink">Severity</th><th class="shrink">Object</th><th class="shrink">Property</th><th class="shrink">Issue</th><th>Recommendation</th></tr></thead>
          <tbody>${findingsRows || '<tr><td colspan="5" class="empty">No issues found — your schema looks clean!</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    <section>
      <h2>Recommended Cleanup Order</h2>
      <ol>${cleanupSteps.join('')}</ol>
    </section>

  </main>
  <script>
    mermaid.initialize({ startOnLoad: true, theme: 'default', er: { diagramPadding: 20, layoutDirection: 'TB' } });

    function showTab(name) {
      document.querySelectorAll('.erd-panel').forEach(p => p.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.getElementById('erd-' + name).classList.add('active');
      event.target.classList.add('active');
    }

    function filterFindings() {
      const sev = document.querySelector('.filter-bar select').value;
      const obj = document.getElementById('object-filter').value;
      document.querySelectorAll('#findings-table tbody tr[data-severity]').forEach(row => {
        const sevOk = !sev || row.dataset.severity === sev;
        const objOk = !obj || row.dataset.object.includes(obj);
        row.style.display = sevOk && objOk ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('HubSpot CRM Schema Audit');
  console.log('========================\n');

  const { hasCli: useCli } = await validateEnvironment();
  if (SKIP_UNUSED) console.log('SKIP_UNUSED=1: will skip property collection for empty objects');
  console.log('');

  // 1. Custom schemas
  console.log('[1/6] Collecting custom object schemas...');
  const customSchemas = await getCustomSchemas(useCli);
  const customNativeEntries = customSchemas.map((s) => ({
    name: s.name || s.objectTypeId,
    objectTypeId: s.objectTypeId,
    label: s.labels?.singular || s.name,
    hasPipelines: true, // custom objects support pipelines (Enterprise)
    isCustom: true,
    properties: s.properties || [],
  }));
  console.log(`  Found ${customNativeEntries.length} custom object type(s)`);

  // 2. Build full object list and check usage
  console.log('\n[2/6] Checking object usage and collecting properties...');
  const allObjectDefs = [
    ...NATIVE_OBJECTS.map((o) => ({ ...o, isCustom: false })),
    ...customNativeEntries,
  ];

  const objects = [];
  for (const def of allObjectDefs) {
    process.stdout.write(`  ${def.label}...`);
    const usage = await checkObjectInUse(def.name);

    if (usage.notFound) {
      console.log(' not found (skipped)');
      continue; // Skip objects not available in this portal
    }

    const statusStr = usage.inUse ? 'in use' : (usage.accessible === false ? 'no access' : 'empty');
    const shouldFetchProps = !SKIP_UNUSED || usage.inUse || !usage.accessible;
    let props;

    if (shouldFetchProps) {
      props = def.isCustom ? def.properties : await getPropertiesForType(def.name);
      if (props === null) {
        // Fall back to objectTypeId if name didn't work
        if (def.objectTypeId && def.objectTypeId !== def.name) {
          props = await getPropertiesForType(def.objectTypeId);
        }
        props = props || [];
      }
    } else {
      props = [];
    }

    objects.push({
      name: def.name,
      label: def.label,
      objectTypeId: def.objectTypeId,
      isCustom: def.isCustom || false,
      hasPipelines: def.hasPipelines,
      usage,
      properties: props,
    });

    console.log(` ${statusStr}, ${props.length} properties`);
  }

  // 3. Pipelines
  console.log('\n[3/6] Collecting pipelines...');
  const pipelines = {};
  const pipelineObjects = objects.filter((o) => o.hasPipelines && (o.usage.inUse || o.isCustom));
  for (const obj of pipelineObjects) {
    const ps = await getPipelinesForObject(obj.name);
    if (ps.length > 0) {
      pipelines[obj.name] = ps;
      console.log(`  ${obj.label}: ${ps.length} pipeline(s)`);
    }
  }

  // 3b. Pipeline record counts (always — needed for fix plan)
  console.log('  Checking record counts per pipeline...');
  const pipelineRecordCounts = {};
  for (const [objName, psList] of Object.entries(pipelines)) {
    for (const pipeline of psList) {
      const count = await getPipelineRecordCount(objName, pipeline.id);
      pipelineRecordCounts[`${objName}:${pipeline.id}`] = count;
      if (count === 0) console.log(`    ${objName} / "${pipeline.label}" — empty`);
    }
  }

  // 4. Association types — build pairs dynamically from accessible objects
  console.log('\n[4/6] Collecting association types...');
  const associations = [];
  // Use accessible objects (in-use or accessible-but-empty); prefer API name over numeric ID
  const assocCandidates = objects
    .filter((o) => o.usage.accessible !== false)
    .map((o) => o.name);

  // Build unique pairs (avoid duplicates and self-pairs)
  const seenPairs = new Set();
  const dynamicPairs = [];
  for (let i = 0; i < assocCandidates.length; i++) {
    for (let j = i + 1; j < assocCandidates.length; j++) {
      const key = [assocCandidates[i], assocCandidates[j]].sort().join('|');
      if (!seenPairs.has(key)) {
        seenPairs.add(key);
        dynamicPairs.push([assocCandidates[i], assocCandidates[j]]);
      }
    }
  }
  console.log(`  Checking ${dynamicPairs.length} object pairs...`);
  for (const [from, to] of dynamicPairs) {
    const types = await getAssociationTypes(from, to);
    if (types.length > 0) associations.push(...types);
  }
  console.log(`  Found ${associations.length} association type(s)`);

  // 5. Limits
  console.log('\n[5/6] Collecting CRM limits...');
  const limits = await getLimitsData();
  const availableLimits = Object.entries(limits).filter(([, v]) => v !== null).map(([k]) => k);
  console.log(`  Limits available: ${availableLimits.join(', ') || 'none (check scopes)'}`);

  // Property validations (for in-use objects with known objectTypeIds)
  const validations = [];
  const validationObjects = objects.filter((o) => o.objectTypeId && o.usage.inUse);
  for (const obj of validationObjects.slice(0, 10)) { // limit to avoid too many requests
    const rules = await getPropertyValidations(obj.objectTypeId);
    validations.push(...rules.map((r) => ({ ...r, objectTypeId: obj.objectTypeId, objectLabel: obj.label })));
  }
  if (validations.length > 0) console.log(`  Found ${validations.length} property validation rule(s)`);

  // 6. Workflows
  let workflows = [], workflowFindings = [];
  if (AUDIT_WORKFLOWS) {
    console.log('\n[6/8] Auditing workflows...');
    workflows = await getWorkflows();
    const enabled = workflows.filter((w) => w.isEnabled).length;
    const noActions = workflows.filter((w) => !(w.actions || []).length).length;
    console.log(`  ${workflows.length} workflows (${enabled} enabled, ${noActions} with no actions)`);
    workflowFindings = analyzeWorkflows(workflows);
    const wfCrit = workflowFindings.filter((f) => f.severity === 'critical').length;
    const wfWarn = workflowFindings.filter((f) => f.severity === 'warning').length;
    console.log(`  ${workflowFindings.length} findings: ${wfCrit} critical, ${wfWarn} warnings`);
  } else {
    console.log('\n[6/8] Workflows skipped (set AUDIT_WORKFLOWS=1 to enable)');
  }

  // 7. Analysis
  console.log('\n[7/8] Running property analysis...');
  const findings = analyzeProperties(objects);
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const warnings = findings.filter((f) => f.severity === 'warning').length;
  const info = findings.filter((f) => f.severity === 'info').length;
  console.log(`  ${findings.length} findings: ${critical} critical, ${warnings} warnings, ${info} info`);

  // 8. Fix plan
  console.log(`\n[8/8] Building fix plan${CHECK_VALUES ? ' (CHECK_VALUES=1: checking property value counts)' : ''}...`);
  const fixPlan = await buildFixPlan(objects, findings, pipelines, pipelineRecordCounts);
  const fp1 = fixPlan.filter((f) => f.tier === 1).length;
  const fp2 = fixPlan.filter((f) => f.tier === 2).length;
  const fp3 = fixPlan.filter((f) => f.tier === 3).length;
  console.log(`  ${fixPlan.length} fixes: ${fp1} auto-fixable, ${fp2} need confirmation, ${fp3} manual`);
  if (!CHECK_VALUES && critical > 0) {
    console.log(`  Tip: re-run with CHECK_VALUES=1 to unlock Tier 1/2 auto-fix for ${critical} duplicate property pair(s)`);
  }

  // Output
  const auditData = {
    generatedAt: new Date().toISOString(),
    portalId: PORTAL_ID || null,
    checkValuesRun: CHECK_VALUES,
    objects,
    pipelines,
    associations,
    limits,
    validations,
    workflows,
    workflowFindings,
    findings,
    fixPlan,
  };

  const dataPath = path.join(OUTPUT_DIR, 'audit-data.json');
  const reportPath = path.join(OUTPUT_DIR, 'audit-report.html');
  const fixPlanPath = path.join(OUTPUT_DIR, 'fix-plan.json');

  fs.writeFileSync(dataPath, JSON.stringify(auditData, null, 2));
  fs.writeFileSync(reportPath, generateHtml(auditData, findings));
  fs.writeFileSync(fixPlanPath, JSON.stringify({
    generatedAt: auditData.generatedAt,
    portalId: auditData.portalId,
    checkValuesRun: CHECK_VALUES,
    fixes: fixPlan,
  }, null, 2));

  console.log('\nDone!');
  console.log(`  Data:      ${dataPath}`);
  console.log(`  Report:    ${reportPath}`);
  console.log(`  Fix plan:  ${fixPlanPath}`);
  console.log('\nOpen audit-report.html in your browser to view the full report.');
}

main().catch((err) => {
  console.error('\nAudit failed:', err.message);
  process.exit(1);
});
