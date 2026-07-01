#!/usr/bin/env node
/**
 * HubSpot Property Dependency Mapper
 *
 * Maps every custom CRM property to the assets that reference it:
 * Forms, Lists (segments), Workflows (enrollment triggers + set-property actions).
 * Identifies which properties are safe to archive vs. blocked by active assets.
 *
 * Required:  HUBSPOT_ACCESS_TOKEN (Private App token)
 * Required scopes: crm.objects.*.read + forms + crm.lists.read + automation
 * Optional:  OUTPUT_DIR (default: cwd)
 * Optional:  INCLUDE_NATIVE=1  (also map HubSpot-defined properties, slower)
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

const TOKEN = process.env.HUBSPOT_ACCESS_TOKEN;
const OUTPUT_DIR = process.env.OUTPUT_DIR || process.cwd();
const INCLUDE_NATIVE = process.env.INCLUDE_NATIVE === '1';

if (!TOKEN) {
  console.error('Error: HUBSPOT_ACCESS_TOKEN is not set.');
  process.exit(1);
}

const NATIVE_OBJECTS = [
  { name: 'contacts',   objectTypeId: '0-1',   label: 'Contacts' },
  { name: 'companies',  objectTypeId: '0-2',   label: 'Companies' },
  { name: 'deals',      objectTypeId: '0-3',   label: 'Deals' },
  { name: 'tickets',    objectTypeId: '0-5',   label: 'Tickets' },
  { name: 'products',   objectTypeId: '0-7',   label: 'Products' },
  { name: 'quotes',     objectTypeId: '0-14',  label: 'Quotes' },
  { name: 'orders',     objectTypeId: '0-123', label: 'Orders' },
  { name: 'leads',      objectTypeId: '0-136', label: 'Leads' },
];

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

function apiRequest(method, hostname, apiPath, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname,
      path: apiPath,
      method,
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        'Content-Type': 'application/json',
        ...extraHeaders,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try { resolve({ status: res.statusCode, body: data ? JSON.parse(data) : {} }); }
          catch { resolve({ status: res.statusCode, body: {} }); }
        } else {
          const err = new Error(`HTTP ${res.statusCode} from ${method} ${hostname}${apiPath}: ${data.slice(0, 200)}`);
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

const apiGet  = (p) => apiRequest('GET',  'api.hubapi.com', p).then(r => r.body);
const apiPost = (p, b) => apiRequest('POST', 'api.hubapi.com', p, b).then(r => r.body);

// ─── Properties ──────────────────────────────────────────────────────────────

async function getPropertiesForObject(objectName) {
  try {
    const resp = await apiGet(`/crm/v3/properties/${objectName}?archived=false`);
    return resp.results || [];
  } catch { return []; }
}

// ─── Forms ────────────────────────────────────────────────────────────────────

async function getAllForms() {
  console.log('  Fetching forms...');
  try {
    // GET /forms/v2/forms?formTypes=ALL — returns all forms including non-marketing
    const forms = await apiGet('/forms/v2/forms?formTypes=ALL&limit=1000');
    if (!Array.isArray(forms)) return [];
    console.log(`  Found ${forms.length} form(s)`);
    return forms;
  } catch (e) {
    if (e.statusCode === 403) {
      console.warn('  Warning: No access to forms API (add "forms" scope to your token)');
      return [];
    }
    console.warn(`  Warning: Could not fetch forms (${e.message})`);
    return [];
  }
}

function extractPropertiesFromForm(form) {
  const props = new Set();
  for (const group of form.formFieldGroups || []) {
    for (const field of group.fields || []) {
      if (field.name) props.add(field.name);
    }
  }
  return [...props];
}

// ─── Lists ────────────────────────────────────────────────────────────────────

async function getAllLists() {
  console.log('  Fetching lists...');
  const lists = [];
  let after;
  try {
    do {
      const resp = await apiPost('/crm/lists/2026-03/search', {
        ...(after ? { offset: after } : {}),
        count: 500,
      });
      const results = resp.lists || resp.results || [];
      lists.push(...results);
      after = resp.offset;
    } while (after && lists.length < 5000);
    console.log(`  Found ${lists.length} list(s)`);
    return lists;
  } catch (e) {
    if (e.statusCode === 403) {
      console.warn('  Warning: No access to lists API (add "crm.lists.read" scope)');
      return [];
    }
    console.warn(`  Warning: Could not fetch lists (${e.message})`);
    return [];
  }
}

async function getListWithFilters(listId) {
  try {
    const resp = await apiGet(`/crm/lists/2026-03/${listId}?includeFilters=true`);
    return resp.list || resp;
  } catch { return null; }
}

function extractPropertiesFromFilterBranch(branch, props = new Set()) {
  if (!branch) return props;
  for (const filter of branch.filters || []) {
    if (filter.filterType === 'PROPERTY' && filter.property) props.add(filter.property);
  }
  for (const sub of branch.filterBranches || []) {
    extractPropertiesFromFilterBranch(sub, props);
  }
  return props;
}

// ─── Workflows ────────────────────────────────────────────────────────────────

async function getAllWorkflows() {
  console.log('  Fetching workflows...');
  const summaries = [];
  let after;
  try {
    do {
      const resp = await apiGet(`/automation/v4/flows?limit=50${after ? `&after=${after}` : ''}`);
      summaries.push(...(resp.results || []));
      after = resp.paging?.next?.after;
    } while (after);
  } catch (e) {
    if (e.statusCode === 403) {
      console.warn('  Warning: No access to workflows (add "automation" scope)');
      return [];
    }
    console.warn(`  Warning: Could not fetch workflows (${e.message})`);
    return [];
  }
  // Fetch full detail for enrollment criteria and actions
  const details = [];
  let i = 0;
  for (const s of summaries) {
    try {
      details.push(await apiGet(`/automation/v4/flows/${s.id}`));
    } catch { details.push(s); }
    i++;
    if (i % 20 === 0) process.stdout.write(`\r    Fetched ${i}/${summaries.length} workflow details...`);
  }
  if (summaries.length > 0) process.stdout.write('\n');
  console.log(`  Found ${summaries.length} workflow(s)`);
  return details;
}

function extractPropertiesFromWorkflow(workflow) {
  const triggerProps = new Set();
  const actionProps = new Set();
  const enrollment = workflow.enrollmentCriteria || {};

  // List-based enrollment: parse filter branches for PROPERTY filters
  if (enrollment.listFilterBranch) {
    extractPropertiesFromFilterBranch(enrollment.listFilterBranch, triggerProps);
  }

  // Re-enrollment triggers
  for (const branch of enrollment.reEnrollmentTriggersFilterBranches || []) {
    extractPropertiesFromFilterBranch(branch, triggerProps);
  }

  // Event-based: property-change events expose properties in their filter branches
  for (const eventBranch of enrollment.eventFilterBranches || []) {
    for (const filter of eventBranch.filters || []) {
      if (filter.property) triggerProps.add(filter.property);
    }
  }

  // Actions: set-property (0-5) actions expose property_name
  for (const action of workflow.actions || []) {
    if (action.actionTypeId === '0-5' && action.fields?.property_name) {
      actionProps.add(action.fields.property_name);
    }
  }

  return { triggerProps: [...triggerProps], actionProps: [...actionProps] };
}

// ─── Dependency Map Builder ───────────────────────────────────────────────────

async function buildDependencyMap(objects, forms, lists, workflows) {
  const map = new Map(); // key = "objectTypeId:propertyName"

  const ensure = (objectTypeId, objectName, objectLabel, prop) => {
    const key = `${objectTypeId}:${prop.name}`;
    if (!map.has(key)) {
      map.set(key, {
        key,
        objectTypeId,
        objectName,
        objectLabel,
        propertyName: prop.name,
        propertyLabel: prop.label || prop.name,
        hubspotDefined: prop.hubspotDefined,
        fieldLevelPermission: prop.fieldLevelPermission || null,
        usages: { forms: [], lists: [], workflows_trigger: [], workflows_action: [] },
        totalUsages: 0,
        canArchive: !prop.hubspotDefined, // start optimistic; will flip false if usages found
        blockingAssets: [],
      });
    }
    return map.get(key);
  };

  // Register all properties
  for (const obj of objects) {
    for (const prop of obj.properties || []) {
      if (!INCLUDE_NATIVE && prop.hubspotDefined) continue;
      ensure(obj.objectTypeId, obj.objectName, obj.objectLabel, prop);
    }
  }

  // Map form field names → property entries
  const formObjectProps = new Set();
  for (const obj of objects) {
    for (const prop of obj.properties || []) formObjectProps.add(prop.name);
  }

  // Forms — fields are untyped (no objectTypeId); link to all objects that have this property
  for (const form of forms) {
    const props = extractPropertiesFromForm(form);
    for (const propName of props) {
      // Find all objects that have this property name
      for (const obj of objects) {
        const prop = (obj.properties || []).find((p) => p.name === propName);
        if (!prop) continue;
        if (!INCLUDE_NATIVE && prop.hubspotDefined) continue;
        const entry = map.get(`${obj.objectTypeId}:${propName}`);
        if (!entry) continue;
        const already = entry.usages.forms.find((f) => f.formId === form.guid);
        if (!already) {
          entry.usages.forms.push({ formId: form.guid, formName: form.name || form.guid, required: false });
        }
      }
    }
  }

  // Lists — need to fetch filter details for DYNAMIC and SNAPSHOT lists
  const listsWithFilters = lists.filter((l) => l.processingType === 'DYNAMIC' || l.processingType === 'SNAPSHOT');
  console.log(`  Fetching filters for ${listsWithFilters.length} dynamic/snapshot lists...`);
  let fetched = 0;
  for (const list of listsWithFilters) {
    const detail = await getListWithFilters(list.listId || list.id);
    if (!detail) continue;
    const branch = detail.filterBranch;
    const propNames = extractPropertiesFromFilterBranch(branch);
    for (const propName of propNames) {
      for (const obj of objects) {
        // Lists are typed by objectTypeId
        if (list.objectTypeId && list.objectTypeId !== obj.objectTypeId) continue;
        const prop = (obj.properties || []).find((p) => p.name === propName);
        if (!prop) continue;
        if (!INCLUDE_NATIVE && prop.hubspotDefined) continue;
        const entry = map.get(`${obj.objectTypeId}:${propName}`);
        if (!entry) continue;
        const already = entry.usages.lists.find((l2) => l2.listId === (list.listId || list.id));
        if (!already) {
          entry.usages.lists.push({
            listId: list.listId || list.id,
            listName: list.name || String(list.listId || list.id),
            processingType: list.processingType,
          });
        }
      }
    }
    fetched++;
    if (fetched % 50 === 0) process.stdout.write(`\r    Processed ${fetched}/${listsWithFilters.length} lists...`);
  }
  if (listsWithFilters.length > 0) process.stdout.write('\n');

  // Workflows
  for (const wf of workflows) {
    const { triggerProps, actionProps } = extractPropertiesFromWorkflow(wf);
    const objectTypeId = wf.objectTypeId;
    const obj = objects.find((o) => o.objectTypeId === objectTypeId);
    if (!obj) continue;

    for (const propName of triggerProps) {
      const prop = (obj.properties || []).find((p) => p.name === propName);
      if (!prop) continue;
      if (!INCLUDE_NATIVE && prop.hubspotDefined) continue;
      const entry = map.get(`${obj.objectTypeId}:${propName}`);
      if (!entry) continue;
      const already = entry.usages.workflows_trigger.find((w) => w.workflowId === wf.id);
      if (!already) {
        entry.usages.workflows_trigger.push({ workflowId: wf.id, workflowName: wf.name || String(wf.id), isEnabled: wf.isEnabled });
      }
    }

    for (const propName of actionProps) {
      const prop = (obj.properties || []).find((p) => p.name === propName);
      if (!prop) continue;
      if (!INCLUDE_NATIVE && prop.hubspotDefined) continue;
      const entry = map.get(`${obj.objectTypeId}:${propName}`);
      if (!entry) continue;
      const already = entry.usages.workflows_action.find((w) => w.workflowId === wf.id);
      if (!already) {
        entry.usages.workflows_action.push({ workflowId: wf.id, workflowName: wf.name || String(wf.id), isEnabled: wf.isEnabled });
      }
    }
  }

  // Finalize canArchive + blockingAssets + totalUsages
  for (const entry of map.values()) {
    const u = entry.usages;
    entry.totalUsages = u.forms.length + u.lists.length + u.workflows_trigger.length + u.workflows_action.length;
    entry.canArchive = !entry.hubspotDefined && entry.totalUsages === 0;
    if (u.forms.length)              entry.blockingAssets.push(...u.forms.map((f) => `Form: ${f.formName}`));
    if (u.lists.length)              entry.blockingAssets.push(...u.lists.map((l) => `List: ${l.listName}`));
    if (u.workflows_trigger.length)  entry.blockingAssets.push(...u.workflows_trigger.map((w) => `WF trigger: ${w.workflowName}`));
    if (u.workflows_action.length)   entry.blockingAssets.push(...u.workflows_action.map((w) => `WF action: ${w.workflowName}`));
  }

  return map;
}

// ─── HTML Report ──────────────────────────────────────────────────────────────

function generateHtml(portalId, objects, depMap) {
  const entries = [...depMap.values()].sort((a, b) => {
    if (a.objectName !== b.objectName) return a.objectName.localeCompare(b.objectName);
    return a.propertyName.localeCompare(b.propertyName);
  });

  const safeToArchive = entries.filter((e) => e.canArchive);
  const blocked = entries.filter((e) => !e.canArchive && !e.hubspotDefined);
  const withAccess = entries.filter((e) => e.fieldLevelPermission);
  const totalCustom = entries.filter((e) => !e.hubspotDefined).length;

  const workflowEditUrl = (wfId) => portalId
    ? `https://app.hubspot.com/workflows/${portalId}/platform/flow/${wfId}/edit`
    : `#wf-${wfId}`;

  const tableRows = entries.filter((e) => !e.hubspotDefined).map((e) => {
    const formTips = e.usages.forms.map((f) => `Form: ${f.formName}`).join('\n');
    const listTips = e.usages.lists.map((l) => `List (${l.processingType}): ${l.listName}`).join('\n');
    const wfTrigTips = e.usages.workflows_trigger.map((w) => `${w.isEnabled ? '✓' : '✗'} WF trigger: ${w.workflowName}`).join('\n');
    const wfActTips = e.usages.workflows_action.map((w) => `${w.isEnabled ? '✓' : '✗'} WF action: ${w.workflowName}`).join('\n');
    const rowClass = e.canArchive ? 'safe' : '';
    const archiveBadge = e.canArchive
      ? '<span class="badge badge-safe">Safe to archive</span>'
      : '<span class="badge badge-blocked">Blocked</span>';
    const permBadge = e.fieldLevelPermission ? '<span class="badge badge-perm">Access restricted</span>' : '';
    return `<tr class="${rowClass}" data-object="${e.objectName}" data-can-archive="${e.canArchive}">
      <td class="shrink"><code>${e.objectName}</code></td>
      <td><strong>${e.propertyLabel}</strong><br><code class="small">${e.propertyName}</code></td>
      <td class="num" title="${formTips}">${e.usages.forms.length || '—'}</td>
      <td class="num" title="${listTips}">${e.usages.lists.length || '—'}</td>
      <td class="num" title="${wfTrigTips}">${e.usages.workflows_trigger.length || '—'}</td>
      <td class="num" title="${wfActTips}">${e.usages.workflows_action.length || '—'}</td>
      <td class="num"><strong>${e.totalUsages || '—'}</strong></td>
      <td class="shrink">${archiveBadge}${permBadge}</td>
    </tr>`;
  }).join('');

  const safeRows = safeToArchive.map((e) => `<tr>
    <td class="shrink"><code>${e.objectName}</code></td>
    <td><strong>${e.propertyLabel}</strong><br><code class="small">${e.propertyName}</code></td>
    <td class="grow">No usages found — safe to archive via API or HubSpot UI</td>
  </tr>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>HubSpot Property Dependency Report</title>
  <style>
    :root{--hs-orange:#ff7a59;--hs-blue:#00a4bd;--hs-dark:#2d3e50;--hs-gray:#f5f8fa;--critical:#c0392b;--warning:#e67e22;--safe:#27ae60}
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:var(--hs-gray);color:var(--hs-dark)}
    header{background:var(--hs-dark);color:white;padding:1.5rem 2rem}
    header h1{font-size:1.4rem;font-weight:600}
    header .meta{font-size:.85rem;color:rgba(255,255,255,.7);margin-top:.25rem}
    main{max-width:1400px;margin:0 auto;padding:2rem}
    section{background:white;border-radius:8px;padding:1.5rem;margin-bottom:1.5rem;box-shadow:0 1px 4px rgba(0,0,0,.08)}
    h2{font-size:1.15rem;font-weight:600;margin-bottom:1rem;color:var(--hs-dark);border-bottom:2px solid var(--hs-gray);padding-bottom:.5rem}
    h3{font-size:1rem;font-weight:600;margin-bottom:.75rem}
    .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:1rem}
    .stat-card{background:var(--hs-gray);border-radius:6px;padding:1rem 1.25rem}
    .stat-card .number{font-size:2rem;font-weight:700}
    .stat-card .label{font-size:.8rem;color:#666;margin-top:2px}
    .stat-card.safe .number{color:var(--safe)}
    .stat-card.blocked .number{color:var(--critical)}
    .filter-bar{display:flex;gap:.75rem;margin-bottom:1rem;flex-wrap:wrap;align-items:center}
    .filter-bar label{font-size:.85rem;font-weight:500}
    .filter-bar select,.filter-bar input{padding:.3rem .6rem;border:1px solid #ddd;border-radius:4px;font-size:.85rem}
    .table-wrap{overflow-x:auto}
    table{width:100%;border-collapse:collapse;font-size:.875rem}
    th{background:var(--hs-gray);padding:.5rem .75rem;text-align:left;font-weight:600;border-bottom:2px solid #e8e8e8;white-space:nowrap}
    td{padding:.5rem .75rem;border-bottom:1px solid #f0f0f0;vertical-align:top}
    td.shrink{width:1%;white-space:nowrap}
    td.num{width:1%;white-space:nowrap;text-align:right;font-variant-numeric:tabular-nums;cursor:help}
    td.grow{word-break:break-word}
    tr.safe td{background:#f0faf4}
    tr:hover td{filter:brightness(0.97)}
    .badge{display:inline-block;padding:.2rem .5rem;border-radius:4px;font-size:.75rem;font-weight:600;white-space:nowrap;margin-right:.25rem}
    .badge-safe{background:#e8f8ed;color:var(--safe)}
    .badge-blocked{background:#fdecea;color:var(--critical)}
    .badge-perm{background:#f3e8fd;color:#7b2d8b}
    code{font-family:'SF Mono',Consolas,monospace;font-size:.8rem;background:#f4f4f4;padding:.1rem .3rem;border-radius:3px;white-space:nowrap}
    code.small{font-size:.72rem;color:#888;background:none;padding:0}
    .empty{color:#999;font-style:italic;text-align:center;padding:2rem}
    a{color:var(--hs-blue)}
    .note{font-size:.85rem;color:#666;margin-bottom:1rem;line-height:1.5}
  </style>
</head>
<body>
  <header>
    <h1>HubSpot Property Dependency Report</h1>
    <div class="meta">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' })}${portalId ? ` · Portal ${portalId}` : ''}</div>
  </header>
  <main>

    <section>
      <h2>Summary</h2>
      <div class="summary-grid">
        <div class="stat-card"><div class="number">${totalCustom.toLocaleString()}</div><div class="label">Custom Properties Mapped</div></div>
        <div class="stat-card safe"><div class="number">${safeToArchive.length}</div><div class="label">Safe to Archive</div></div>
        <div class="stat-card blocked"><div class="number">${blocked.length}</div><div class="label">Blocked by Asset</div></div>
        ${withAccess.length > 0 ? `<div class="stat-card"><div class="number">${withAccess.length}</div><div class="label">Access Restricted</div></div>` : ''}
        <div class="stat-card"><div class="number">${[...depMap.values()].reduce((s,e)=>s+e.usages.forms.length,0)}</div><div class="label">Form Usages</div></div>
        <div class="stat-card"><div class="number">${[...depMap.values()].reduce((s,e)=>s+e.usages.lists.length,0)}</div><div class="label">List Usages</div></div>
        <div class="stat-card"><div class="number">${[...depMap.values()].reduce((s,e)=>s+e.usages.workflows_trigger.length+e.usages.workflows_action.length,0)}</div><div class="label">Workflow Usages</div></div>
      </div>
    </section>

    <section>
      <h2>Property Dependency Matrix</h2>
      <p class="note">Hover over usage counts to see which assets use each property. Green rows are safe to archive. Cells show count of assets referencing this property.</p>
      <div class="filter-bar">
        <label>Object:</label>
        <select onchange="filterTable()">
          <option value="">All Objects</option>
          ${[...new Set(entries.filter(e=>!e.hubspotDefined).map(e=>e.objectName))].map(n=>`<option value="${n}">${n}</option>`).join('')}
        </select>
        <label>Show:</label>
        <select onchange="filterTable()" id="show-filter">
          <option value="all">All properties</option>
          <option value="safe">Safe to archive only</option>
          <option value="blocked">Blocked only</option>
        </select>
        <input type="text" placeholder="Search property..." oninput="filterTable()" id="search-filter" style="min-width:180px">
      </div>
      <div class="table-wrap">
        <table id="dep-table">
          <thead>
            <tr>
              <th class="shrink">Object</th>
              <th>Property</th>
              <th class="num" title="Forms using this property">Forms</th>
              <th class="num" title="Lists/segments filtering on this property">Lists</th>
              <th class="num" title="Workflows triggered by this property">WF Trigger</th>
              <th class="num" title="Workflows that set this property">WF Action</th>
              <th class="num">Total</th>
              <th class="shrink">Status</th>
            </tr>
          </thead>
          <tbody id="dep-tbody">${tableRows || '<tr><td colspan="8" class="empty">No custom properties found</td></tr>'}</tbody>
        </table>
      </div>
    </section>

    ${safeToArchive.length > 0 ? `
    <section>
      <h2>Safe to Archive (${safeToArchive.length} properties)</h2>
      <p class="note">These custom properties have no usages in Forms, Lists, or Workflows. They can be archived via the HubSpot UI or <code>DELETE /crm/v3/properties/{objectType}/{propertyName}</code>.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="shrink">Object</th><th>Property</th><th>Note</th></tr></thead>
          <tbody>${safeRows}</tbody>
        </table>
      </div>
    </section>` : ''}

    ${withAccess.length > 0 ? `
    <section>
      <h2>Access Restricted Properties (${withAccess.length})</h2>
      <p class="note">These properties have non-default field-level permissions (Enterprise feature). Review before archiving.</p>
      <div class="table-wrap">
        <table>
          <thead><tr><th class="shrink">Object</th><th>Property</th><th>Access Level</th></tr></thead>
          <tbody>${withAccess.map(e=>`<tr><td class="shrink"><code>${e.objectName}</code></td><td>${e.propertyLabel} <code class="small">${e.propertyName}</code></td><td><code>${JSON.stringify(e.fieldLevelPermission)}</code></td></tr>`).join('')}</tbody>
        </table>
      </div>
    </section>` : ''}

  </main>
  <script>
    function filterTable() {
      const objFilter = document.querySelector('.filter-bar select').value;
      const showFilter = document.getElementById('show-filter').value;
      const search = document.getElementById('search-filter').value.toLowerCase();
      document.querySelectorAll('#dep-tbody tr[data-object]').forEach(row => {
        const obj = row.dataset.object || '';
        const canArchive = row.dataset.canArchive === 'true';
        const text = row.textContent.toLowerCase();
        const objOk = !objFilter || obj === objFilter;
        const showOk = showFilter === 'all' || (showFilter === 'safe' && canArchive) || (showFilter === 'blocked' && !canArchive);
        const searchOk = !search || text.includes(search);
        row.style.display = objOk && showOk && searchOk ? '' : 'none';
      });
    }
  </script>
</body>
</html>`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('HubSpot Property Dependency Mapper');
  console.log('===================================\n');

  // Validate token + get portal ID
  let portalId = '';
  try {
    const info = await apiGet('/account-info/v3/details');
    portalId = String(info.portalId || '');
    console.log(`Portal: ${portalId}\n`);
  } catch (e) {
    if (e.statusCode === 401) {
      console.error('Error: HUBSPOT_ACCESS_TOKEN is invalid or expired (401).');
      process.exit(1);
    }
    console.warn(`Warning: Could not resolve portal ID (${e.message})\n`);
  }

  // Test internal usage API (browser-only — will 401 with Private App token)
  console.log('[0/5] Testing internal HubSpot usage API...');
  try {
    await apiRequest('GET', 'app.hubspot.com',
      `/api/crm-usages/v2/usages/PROPERTY/0-1%2Femail/parents/page?portalId=${portalId}&clienttimeout=5000`
    );
    console.log('  Internal API accessible — could use for additional coverage (not implemented yet).');
  } catch {
    console.log('  Internal usage API (browser session auth only) — using asset-definition approach instead.\n');
  }

  // 1. Collect all properties from major objects
  console.log('[1/5] Collecting properties...');
  let customSchemas = [];
  try {
    const resp = await apiGet('/crm/v3/schemas?archived=false');
    customSchemas = (resp.results || []).map((s) => ({
      name: s.name || s.objectTypeId,
      objectTypeId: s.objectTypeId,
      label: s.labels?.singular || s.name,
    }));
  } catch { /* custom schemas optional */ }

  const objectDefs = [...NATIVE_OBJECTS, ...customSchemas];
  const objects = [];
  for (const def of objectDefs) {
    const props = await getPropertiesForObject(def.name);
    if (props.length > 0 || INCLUDE_NATIVE) {
      objects.push({ ...def, properties: props });
      process.stdout.write(`  ${def.label}: ${props.filter(p=>!p.hubspotDefined).length} custom, ${props.filter(p=>p.hubspotDefined).length} native\n`);
    }
  }

  // 2. Forms
  console.log('\n[2/5] Loading forms...');
  const forms = await getAllForms();

  // 3. Lists
  console.log('\n[3/5] Loading lists...');
  const lists = await getAllLists();

  // 4. Workflows
  console.log('\n[4/5] Loading workflows...');
  const workflows = await getAllWorkflows();

  // 5. Build dependency map
  console.log('\n[5/5] Building dependency map...');
  const depMap = await buildDependencyMap(objects, forms, lists, workflows);

  const customEntries = [...depMap.values()].filter((e) => !e.hubspotDefined);
  const safe = customEntries.filter((e) => e.canArchive).length;
  const blocked = customEntries.filter((e) => !e.canArchive).length;
  console.log(`  ${customEntries.length} custom properties mapped: ${safe} safe to archive, ${blocked} blocked`);

  // Output
  const depData = {
    generatedAt: new Date().toISOString(),
    portalId: portalId || null,
    summary: { totalCustom: customEntries.length, safeToArchive: safe, blocked },
    properties: Object.fromEntries(depMap),
  };

  const dataPath = path.join(OUTPUT_DIR, 'dependency-data.json');
  const reportPath = path.join(OUTPUT_DIR, 'dependency-report.html');

  fs.writeFileSync(dataPath, JSON.stringify(depData, null, 2));
  fs.writeFileSync(reportPath, generateHtml(portalId, objects, depMap));

  console.log('\nDone!');
  console.log(`  Data:    ${dataPath}`);
  console.log(`  Report:  ${reportPath}`);
  console.log('\nOpen dependency-report.html to view the full report.');
}

main().catch((err) => {
  console.error('\nDependency mapper failed:', err.message);
  process.exit(1);
});
