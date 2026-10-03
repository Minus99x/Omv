import { getBrowserChain } from './chains/index.js';
import { createCapabilityUiModel, selectCapabilityContracts } from './capability-ui.js';
import { createEvidenceProvenanceUiModel, resolveEvidenceReference } from './evidence-provenance-ui.js';
import { createEvidenceHistoryUiModel, selectEvidenceHistory } from './evidence-history-ui.js';
import { createEvidenceDiagnosticsUiModel, selectEvidenceDiagnostics } from './evidence-diagnostics-ui.js';
import { createProvenanceAuditUiModel, serializeValidatedProvenanceAudit } from './provenance-audit-ui.js';
import { createOperatorAuditIndexUiModel } from './operator-audit-index-ui.js';

const $ = (id) => document.getElementById(id);
const selectedChainId = 'ethereum';
const chain = getBrowserChain(selectedChainId);
const DRAFT_KEY = 'omegavault.test-policy-draft.v1';
const ACTIVE_VAULT_KEY = 'omegavault.active-vault-id.v1';

let account = null;
let currentVault = null;
let ethereumArtifact = null;
let ethereumContractMeta = null;
let walletNetwork = null;
let appConfig = null;
let lastChainState = null;
let permittedAccounts = [];
let approvalStatuses = [];
let contactBalances = [];
let capabilityUiModel = null;
let evidenceProvenanceUiModel = null;
let evidenceHistoryUiModel = null;
let evidenceDiagnosticsUiModel = null;
let provenanceAuditUiModel = null;
let operatorAuditIndexUiModel = null;

function toast(message, duration = 4200) {
  const el = $('toast');
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.add('hidden'), duration);
}

function setBusy(button, busy, busyText = 'Working…') {
  if (!button) return;
  if (busy) {
    button.dataset.label = button.textContent;
    button.textContent = busyText;
    button.disabled = true;
  } else {
    button.textContent = button.dataset.label || button.textContent;
    button.disabled = false;
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'content-type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function short(value) { return value ? `${value.slice(0, 7)}…${value.slice(-5)}` : '—'; }
function sameAddress(a, b) { return typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase(); }
function formatEth(wei) {
  const n = BigInt(wei);
  const whole = n / 10n ** 18n;
  const fraction = (n % 10n ** 18n).toString().padStart(18, '0').slice(0, 6);
  return `${whole}.${fraction} ETH`;
}
function nonce() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  return [...bytes].map(v => v.toString(16).padStart(2, '0')).join('');
}


function appendList(container, items, emptyText) {
  const list = document.createElement('ul');
  list.className = 'capability-list';
  if (!items.length) {
    const item = document.createElement('li');
    item.textContent = emptyText;
    list.append(item);
  } else {
    for (const value of items) {
      const item = document.createElement('li');
      item.textContent = value;
      list.append(item);
    }
  }
  container.append(list);
}



function appendEvidenceProvenance(container, refs, chainId) {
  const wrapper = document.createElement('div');
  wrapper.className = 'gate-provenance';
  if (!refs.length) {
    const none = document.createElement('small');
    none.className = 'muted';
    none.textContent = 'No evidence reference registered for this gate.';
    wrapper.append(none);
    container.append(wrapper);
    return;
  }
  for (const ref of refs) {
    const provenance = resolveEvidenceReference(evidenceProvenanceUiModel, ref, chainId);
    const details = document.createElement('details');
    details.className = `provenance-record ${provenance ? 'resolved' : 'unresolved'}`;
    const summary = document.createElement('summary');
    summary.textContent = ref;
    details.append(summary);
    if (!provenance) {
      const unavailable = document.createElement('div');
      unavailable.className = 'provenance-unavailable';
      unavailable.textContent = 'Provenance unavailable or not registered for this chain. No additional claim is inferred.';
      details.append(unavailable);
    } else {
      const body = document.createElement('div');
      body.className = 'provenance-body';
      const scope = document.createElement('div');
      scope.textContent = `Scope: ${provenance.scope}`;
      const checkpoint = document.createElement('div');
      checkpoint.textContent = `Checkpoint: ${provenance.checkpointRef}`;
      const archive = document.createElement('div');
      archive.className = 'mono';
      archive.textContent = `Archive: ${provenance.archiveFilename}`;
      const digest = document.createElement('div');
      digest.className = 'mono provenance-digest';
      digest.textContent = `SHA-256: ${provenance.archiveSha256}`;
      const parent = document.createElement('div');
      parent.className = 'mono provenance-parent';
      parent.textContent = provenance.parentBundleSha256 ? `Parent bundle SHA-256: ${provenance.parentBundleSha256}` : 'Parent bundle: not recorded';
      const description = document.createElement('div');
      description.textContent = provenance.summary;
      const artifacts = document.createElement('ul');
      artifacts.className = 'provenance-artifacts';
      for (const path of provenance.artifactPaths) {
        const item = document.createElement('li');
        item.className = 'mono';
        item.textContent = path;
        artifacts.append(item);
      }
      body.append(scope, checkpoint, archive, digest, parent, description, artifacts);
      details.append(body);
    }
    wrapper.append(details);
  }
  container.append(wrapper);
}

function renderCapabilityDashboard(model) {
  const status = $('capabilityStatus');
  const container = $('capabilityGrid');
  if (!status || !container) return;
  container.replaceChildren();
  if (!model?.available) {
    status.textContent = 'Status unavailable';
    status.className = 'status status-unavailable';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = `Multichain maturity status is unavailable. ${model?.reason || 'No validated capability response was received.'} No promotion claim is being made.`;
    container.append(empty);
    return;
  }

  status.textContent = `${model.contracts.length} chains · ${model.eligibleCount} eligible · ${model.blockedCount} blocked · backend validated`;
  const filter = $('capabilityFilter')?.value || 'all';
  const sort = $('capabilitySort')?.value || 'name';
  const visibleContracts = selectCapabilityContracts(model, { filter, sort });
  $('capabilityVisibleSummary').textContent = `Showing ${visibleContracts.length} of ${model.contracts.length} backend-validated chain contracts.`;
  status.className = 'status status-validated';
  if (visibleContracts.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'No chain contracts match the selected backend-status filter.';
    container.append(empty);
    return;
  }
  for (const contract of visibleContracts) {
    const card = document.createElement('section');
    card.setAttribute('role', 'listitem');
    card.tabIndex = 0;
    card.className = `capability-card ${contract.promotionEligible ? 'promotion-eligible' : 'promotion-blocked'}`;

    const head = document.createElement('div');
    head.className = 'capability-head';
    const title = document.createElement('div');
    const name = document.createElement('strong');
    const headingId = `capability-${contract.chainId.replace(/[^a-z0-9_-]/gi, '-')}`;
    name.id = headingId;
    name.textContent = contract.name;
    card.setAttribute('aria-labelledby', headingId);
    const id = document.createElement('span');
    id.className = 'mono small muted';
    id.textContent = contract.chainId;
    title.append(name, id);
    const badge = document.createElement('span');
    badge.className = contract.promotionEligible ? 'capability-badge eligible' : 'capability-badge blocked';
    badge.textContent = contract.promotionLabel;
    head.append(title, badge);
    card.append(head);

    const meta = document.createElement('div');
    meta.className = 'capability-meta';
    const stage = document.createElement('span');
    stage.textContent = `Stage: ${contract.stage}`;
    const adapter = document.createElement('span');
    adapter.textContent = `Adapter label: ${contract.adapterImplementationStage}`;
    meta.append(stage, adapter);
    card.append(meta);

    const evidence = document.createElement('div');
    evidence.className = 'evidence-levels';
    for (const [level, count] of Object.entries(contract.evidenceCounts).sort(([a],[b]) => a.localeCompare(b))) {
      const pill = document.createElement('span');
      pill.className = 'evidence-pill';
      pill.textContent = `${level}: ${count}`;
      evidence.append(pill);
    }
    card.append(evidence);

    const blockers = document.createElement('details');
    blockers.open = contract.blockers.length > 0;
    const blockersSummary = document.createElement('summary');
    blockersSummary.textContent = `Blockers (${contract.blockers.length})`;
    blockers.append(blockersSummary);
    appendList(blockers, contract.blockers, 'No blockers reported by the backend contract.');
    card.append(blockers);

    const gates = document.createElement('details');
    const gatesSummary = document.createElement('summary');
    gatesSummary.textContent = `Promotion gates · missing ${contract.missingGates.length} · insufficient ${contract.insufficientEvidenceGates.length}`;
    gates.append(gatesSummary);
    const gateTable = document.createElement('div');
    gateTable.className = 'gate-table';
    for (const gate of contract.gateEvidence) {
      const row = document.createElement('div');
      row.className = `gate-row ${gate.evidenceSufficient ? 'sufficient' : gate.passed ? 'insufficient' : 'missing'}`;
      const gateCopy = document.createElement('div');
      const gateName = document.createElement('span');
      gateName.textContent = gate.gate;
      const refs = document.createElement('small');
      refs.className = 'gate-refs mono';
      refs.textContent = gate.refs.length ? `Evidence refs: ${gate.refs.length}` : 'Evidence: none';
      gateCopy.append(gateName, refs);
      appendEvidenceProvenance(gateCopy, gate.refs, contract.chainId);
      const level = document.createElement('span');
      level.textContent = gate.passed ? `${gate.level} / min ${gate.minimumEvidence}` : `missing / min ${gate.minimumEvidence}`;
      row.append(gateCopy, level);
      gateTable.append(row);
    }
    gates.append(gateTable);
    card.append(gates);
    container.append(card);
  }
}

async function loadCapabilityDashboard() {
  try {
    const [capabilityEnvelope, provenanceEnvelope, evidenceHistoryEnvelope, evidenceDiagnosticsEnvelope, provenanceAuditEnvelope, operatorAuditIndexEnvelope] = await Promise.all([
      api('/api/chain-capabilities'),
      api('/api/evidence-provenance'),
      api('/api/evidence-history'),
      api('/api/evidence-diagnostics'),
      api('/api/provenance-audit'),
      api('/api/operator-audit-index')
    ]);
    capabilityUiModel = createCapabilityUiModel(capabilityEnvelope);
    evidenceProvenanceUiModel = createEvidenceProvenanceUiModel(provenanceEnvelope);
    evidenceHistoryUiModel = createEvidenceHistoryUiModel(evidenceHistoryEnvelope);
    evidenceDiagnosticsUiModel = createEvidenceDiagnosticsUiModel(evidenceDiagnosticsEnvelope);
    provenanceAuditUiModel = createProvenanceAuditUiModel(provenanceAuditEnvelope);
    operatorAuditIndexUiModel = createOperatorAuditIndexUiModel(operatorAuditIndexEnvelope);
  } catch (error) {
    capabilityUiModel = createCapabilityUiModel(null);
    capabilityUiModel = Object.freeze({ ...capabilityUiModel, reason: `Capability API request failed: ${error.message}` });
    evidenceProvenanceUiModel = createEvidenceProvenanceUiModel(null);
    evidenceHistoryUiModel = createEvidenceHistoryUiModel(null);
    evidenceDiagnosticsUiModel = createEvidenceDiagnosticsUiModel(null);
    provenanceAuditUiModel = createProvenanceAuditUiModel(null);
    operatorAuditIndexUiModel = createOperatorAuditIndexUiModel(null);
  }
  renderCapabilityDashboard(capabilityUiModel);
  renderEvidenceHistory(evidenceHistoryUiModel);
  renderEvidenceDiagnostics(evidenceDiagnosticsUiModel);
  renderProvenanceAudit(provenanceAuditUiModel);
  renderOperatorAuditIndex(operatorAuditIndexUiModel);
}

$('capabilityFilter')?.addEventListener('change', () => renderCapabilityDashboard(capabilityUiModel));
$('capabilitySort')?.addEventListener('change', () => renderCapabilityDashboard(capabilityUiModel));


function renderEvidenceHistory(model) {
  const status = $('evidenceHistoryStatus');
  const container = $('evidenceHistoryList');
  const summary = $('evidenceHistorySummary');
  if (!status || !container || !summary) return;
  container.replaceChildren();
  if (!model?.available) {
    status.textContent = 'History unavailable';
    status.className = 'status status-unavailable';
    summary.textContent = model?.reason || 'No validated evidence-history response was received.';
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = 'Evidence history is unavailable. No maturity or promotion state is inferred from missing history.';
    container.append(empty);
    return;
  }
  const query = $('evidenceHistorySearch')?.value || '';
  const chainId = $('evidenceHistoryChain')?.value || 'all';
  const sort = $('evidenceHistorySort')?.value || 'newest';
  let rows;
  try { rows = selectEvidenceHistory(model, { query, chainId, sort }); }
  catch (error) {
    status.textContent = 'History controls invalid';
    status.className = 'status status-unavailable';
    summary.textContent = error.message;
    return;
  }
  status.textContent = `${model.summary.checkpointCount} evidence checkpoints · ${model.summary.evidenceRefCount} refs · backend validated`;
  status.className = 'status status-validated';
  summary.textContent = `Showing ${rows.length} of ${model.checkpoints.length} evidence checkpoints. Timeline links show evidence-checkpoint order only, not source ancestry.`;
  if (!rows.length) {
    const empty = document.createElement('div'); empty.className='empty'; empty.textContent='No evidence checkpoints match the current history search/filter.'; container.append(empty); return;
  }
  for (const row of rows) {
    const card=document.createElement('section'); card.className='history-card'; card.tabIndex=0;
    const head=document.createElement('div'); head.className='history-head';
    const title=document.createElement('strong'); title.textContent=row.checkpointRef;
    const chains=document.createElement('span'); chains.className='history-chain-badges'; chains.textContent=row.chainIds.join(' · ');
    head.append(title,chains); card.append(head);
    const meta=document.createElement('div'); meta.className='history-meta mono'; meta.textContent=`${row.archiveFilename} · ${row.archiveSha256}`; card.append(meta);
    const relation=document.createElement('div'); relation.className='history-relation'; relation.textContent=`Timeline: ${row.previousEvidenceCheckpointRef || 'start'} ← ${row.checkpointRef} → ${row.nextEvidenceCheckpointRef || 'latest'} · order only, not source ancestry`; card.append(relation);
    const refs=document.createElement('details'); const rs=document.createElement('summary'); rs.textContent=`Evidence refs (${row.evidenceRefs.length})`; refs.append(rs);
    appendList(refs,row.evidenceRefs,'No refs'); card.append(refs);
    const scopes=document.createElement('details'); const ss=document.createElement('summary'); ss.textContent=`Scopes (${row.scopes.length})`; scopes.append(ss); appendList(scopes,row.scopes,'No scopes'); card.append(scopes);
    const artifacts=document.createElement('details'); const ars=document.createElement('summary'); ars.textContent=`Artifacts (${row.artifactPaths.length})`; artifacts.append(ars); appendList(artifacts,row.artifactPaths,'No artifacts'); card.append(artifacts);
    container.append(card);
  }
}


function renderEvidenceDiagnostics(model) {
  const status=$('evidenceDiagnosticsStatus');
  const container=$('evidenceDiagnosticsList');
  const summary=$('evidenceDiagnosticsSummary');
  if(!status||!container||!summary)return;
  container.replaceChildren();
  if(!model?.available){status.textContent='Diagnostics unavailable';status.className='status status-unavailable';summary.textContent=model?.reason||'No validated diagnostics response was received.';const empty=document.createElement('div');empty.className='empty';empty.textContent='Evidence diagnostics are unavailable. No maturity state is inferred.';container.append(empty);return;}
  const filter=$('evidenceDiagnosticsFilter')?.value||'all';
  const sort=$('evidenceDiagnosticsSort')?.value||'name';
  let rows;
  try{rows=selectEvidenceDiagnostics(model,{filter,sort});}catch(error){status.textContent='Diagnostics controls invalid';status.className='status status-unavailable';summary.textContent=error.message;return;}
  status.textContent=`${model.summary.chainCount} chains · ${model.summary.healthyProvenanceCount} provenance-healthy · ${model.summary.errorCount} provenance errors`;
  status.className=model.summary.errorCount?'status status-unavailable':'status status-validated';
  summary.textContent=`Showing ${rows.length} of ${model.diagnostics.length} chain diagnostics. Explicit lineage counts cryptographic parent bindings only.`;
  if(!rows.length){const empty=document.createElement('div');empty.className='empty';empty.textContent='No chain diagnostics match the selected filter.';container.append(empty);return;}
  for(const row of rows){
    const card=document.createElement('section');card.className=`diagnostic-card severity-${row.severity}`;card.tabIndex=0;
    const head=document.createElement('div');head.className='diagnostic-head';const title=document.createElement('strong');title.textContent=row.name;const badge=document.createElement('span');badge.className='diagnostic-badge';badge.textContent=row.severity;head.append(title,badge);card.append(head);
    const meta=document.createElement('div');meta.className='diagnostic-meta';meta.textContent=`${row.resolvedEvidenceRefCount}/${row.evidenceRefCount} evidence refs resolved · provenance ${row.provenanceHealthy?'healthy':'error'} · lineage ${row.explicitLineage.status}`;card.append(meta);
    const lineage=document.createElement('div');lineage.className='diagnostic-lineage';lineage.textContent=row.explicitLineage.note;card.append(lineage);
    const gaps=document.createElement('details');const gs=document.createElement('summary');gs.textContent=`Evidence gaps · missing ${row.missingGates.length} · insufficient ${row.insufficientEvidenceGates.length} · blockers ${row.blockers.length}`;gaps.append(gs);appendList(gaps,row.missingGates,'No missing gates.');appendList(gaps,row.insufficientEvidenceGates,'No insufficient-evidence gates.');appendList(gaps,row.blockers,'No blockers.');card.append(gaps);
    if(row.unresolvedEvidenceRefs.length||row.crossWiredEvidenceRefs.length){const integrity=document.createElement('details');integrity.open=true;const is=document.createElement('summary');is.textContent='Provenance integrity errors';integrity.append(is);appendList(integrity,row.unresolvedEvidenceRefs,'No unresolved refs.');appendList(integrity,row.crossWiredEvidenceRefs,'No cross-wired refs.');card.append(integrity);}
    container.append(card);
  }
}

function renderProvenanceAudit(model) {
  const status = $('provenanceAuditStatus');
  const summary = $('provenanceAuditSummary');
  const exportButton = $('provenanceAuditExport');
  if (!status || !summary || !exportButton) return;
  if (!model?.available) {
    status.textContent = 'Audit unavailable';
    status.className = 'status status-unavailable';
    summary.textContent = model?.reason || 'No backend-validated provenance audit was received.';
    exportButton.disabled = true;
    return;
  }
  const audit = model.audit;
  status.textContent = `Audit ${audit.sha256.slice(0, 12)}… · backend validated`;
  status.className = 'status status-validated';
  summary.textContent = `${audit.inventory.provenanceRecordCount} provenance refs · ${audit.inventory.evidenceCheckpointCount} evidence checkpoints · lineage ${audit.lineageRecovery.status} (${audit.lineageRecovery.recoveredBindingCount} recovered, ${audit.lineageRecovery.unrecordedRefCount} not recorded).`;
  exportButton.disabled = false;
}

function renderOperatorAuditIndex(model) {
  const status = $('operatorAuditIndexStatus');
  const summary = $('operatorAuditIndexSummary');
  if (!status || !summary) return;
  if (!model?.available) {
    status.textContent = 'Review index unavailable';
    status.className = 'status status-unavailable';
    summary.textContent = model?.reason || 'No backend-validated operator audit index was received.';
    return;
  }
  const index = model.index;
  status.textContent = `Index ${index.sha256.slice(0, 12)}… · backend validated`;
  status.className = 'status status-validated';
  summary.textContent = `${index.checkpointRef} · provenance audit ${index.provenanceAuditSha256.slice(0, 12)}… · evidence history ${index.evidenceHistorySha256.slice(0, 12)}… · external archive/sidecar identity attaches after archive seal.`;
}

function permissionHas(address) {
  return permittedAccounts.some(value => sameAddress(value, address));
}

function signingAccountsForVault() {
  if (!currentVault) return [];
  return [currentVault.owner, ...currentVault.trustedContacts];
}

function pendingTrustedContacts() {
  if (!currentVault) return [];
  return currentVault.trustedContacts.filter(contact => !approvalStatuses.some(item => sameAddress(item.contact, contact) && item.approved));
}

function roleForAccount(value = account) {
  if (!value || !currentVault) return 'Wallet not connected';
  if (sameAddress(value, currentVault.owner)) return 'Owner wallet';
  if (currentVault.trustedContacts.some(v => sameAddress(v, value))) return 'Trusted contact wallet';
  if (sameAddress(value, currentVault.rescueDestination)) return 'Rescue destination';
  return 'Unconfigured wallet';
}

function renderPermissionSummary() {
  if (!$('permissionSummary')) return;
  if (!currentVault) {
    $('permissionSummary').textContent = permittedAccounts.length ? `${permittedAccounts.length} wallet account(s) authorized.` : 'No wallet accounts authorized yet.';
    return;
  }
  const rows = [
    ['Owner', currentVault.owner],
    ...currentVault.trustedContacts.map((address, index) => [`Trusted ${String.fromCharCode(65 + index)}`, address])
  ];
  $('permissionSummary').textContent = rows.map(([label, address]) => `${permissionHas(address) ? '✓' : '○'} ${label} ${short(address)}`).join('   ');
}

function saveDraft() {
  const draft = {
    owner: $('owner').value,
    destination: $('destination').value,
    contacts: $('contacts').value,
    threshold: $('threshold').value,
    inactivityDays: $('inactivityDays').value,
    testInactivitySeconds: $('testInactivitySeconds').value,
    depositAmount: $('depositAmount').value,
    contactFundingAmount: $('contactFundingAmount').value
  };
  localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function restoreDraft() {
  try {
    const draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (!draft) return;
    if (draft.owner) $('owner').value = draft.owner;
    if (draft.destination) $('destination').value = draft.destination;
    if (draft.contacts) $('contacts').value = draft.contacts;
    if (draft.threshold) $('threshold').value = draft.threshold;
    if (draft.inactivityDays) $('inactivityDays').value = draft.inactivityDays;
    if (draft.testInactivitySeconds) $('testInactivitySeconds').value = draft.testInactivitySeconds;
    if (draft.depositAmount) $('depositAmount').value = draft.depositAmount;
    if (draft.contactFundingAmount) $('contactFundingAmount').value = draft.contactFundingAmount;
  } catch { /* ignore malformed local draft */ }
}

async function refreshWallet({ request = false } = {}) {
  if (!chain.available()) {
    permittedAccounts = [];
    account = null;
    $('walletStatus').textContent = 'No injected wallet';
    $('walletHint').innerHTML = '<strong>No wallet provider detected.</strong> On a phone, open this OmegaVault address inside MetaMask\'s in-app browser. On desktop, install/use a wallet extension.';
    renderPermissionSummary();
    renderLiveLayer();
    return;
  }

  permittedAccounts = request ? await chain.requestAccountAccess() : await chain.connectedAccounts();
  account = permittedAccounts[0] ?? null;
  walletNetwork = await chain.network();

  if (!account) {
    $('account').textContent = 'No authorized account';
    $('balance').textContent = '—';
    $('walletStatus').textContent = 'Not connected';
    $('connectButton').textContent = 'Authorize wallet';
    $('chainName').textContent = `${walletNetwork.id} (${walletNetwork.label})`;
    $('networkPill').textContent = walletNetwork.isSepolia ? 'Ethereum · Sepolia testnet' : `Ethereum · ${walletNetwork.label}`;
    renderPermissionSummary();
    renderLiveLayer();
    return;
  }

  const displayAccount = currentVault && permissionHas(currentVault.owner) ? currentVault.owner : account;
  const balance = await chain.readNativeBalance(displayAccount);
  $('account').textContent = permittedAccounts.length > 1 ? `${displayAccount} (${permittedAccounts.length} authorized)` : displayAccount;
  if (!$('owner').value) $('owner').value = displayAccount;
  $('chainName').textContent = `${walletNetwork.id} (${walletNetwork.label})`;
  $('balance').textContent = balance;
  $('walletStatus').textContent = permittedAccounts.length > 1 ? `${permittedAccounts.length} accounts authorized` : `Connected ${short(displayAccount)}`;
  $('connectButton').textContent = 'Wallet authorized';
  $('signProofButton').disabled = false;
  $('networkPill').textContent = walletNetwork.isSepolia ? 'Ethereum · Sepolia testnet' : `Ethereum · ${walletNetwork.label}`;
  saveDraft();
  renderPermissionSummary();
  renderLiveLayer();
}

async function authorizeTestRoles() {
  if (!currentVault) throw new Error('Load the existing OmegaVault policy first.');
  const accounts = await chain.requestAccountAccess();
  permittedAccounts = accounts;
  account = accounts[0] ?? null;
  await refreshWallet({ request: false });
  const missing = signingAccountsForVault().filter(address => !permissionHas(address));
  if (missing.length) throw new Error(`MetaMask still has not authorized ${missing.length} required signing account(s). Open the dapp account permissions once and select Owner plus both trusted contacts.`);
  toast('Owner and trusted-contact accounts are authorized. You no longer need to disconnect/reconnect between test roles.', 7500);
}

async function compileEthereumContract() {
  if (ethereumArtifact) return ethereumArtifact;
  const button = $('compileContract');
  setBusy(button, true, 'Compiling…');
  $('compilerStatus').textContent = 'Loading pinned Solidity compiler…';
  try {
    ethereumContractMeta = await api('/api/ethereum/contract-source');
    ethereumArtifact = await new Promise((resolve, reject) => {
      const worker = new Worker('/solidity-worker.js');
      const timer = setTimeout(() => {
        worker.terminate();
        reject(new Error('Solidity compilation timed out locally.'));
      }, 120_000);
      worker.onmessage = (event) => {
        clearTimeout(timer);
        worker.terminate();
        event.data?.ok ? resolve(event.data.artifact) : reject(new Error(event.data?.error || 'Compilation failed.'));
      };
      worker.onerror = (event) => {
        clearTimeout(timer);
        worker.terminate();
        reject(new Error(event.message || 'Compiler worker failed.'));
      };
      worker.postMessage({ source: ethereumContractMeta.source });
    });
    $('compilerStatus').textContent = `Solidity ${ethereumArtifact.compilerVersion} · contract ${ethereumContractMeta.contractVersion}`;
    $('compileContract').textContent = 'Contract compiled';
    renderRunbook();
    return ethereumArtifact;
  } finally {
    setBusy(button, false);
    if (ethereumArtifact) button.textContent = 'Contract compiled';
    renderLiveLayer();
  }
}

function setRunState(id, done, current = false) {
  const el = $(id);
  el.classList.toggle('done', Boolean(done));
  el.classList.toggle('current', !done && Boolean(current));
}

function renderRunbook() {
  const binding = currentVault?.chainBindings?.ethereum;
  const connected = permittedAccounts.length > 0;
  const sepolia = Boolean(walletNetwork?.isSepolia);
  const policy = Boolean(currentVault);
  const compiled = Boolean(ethereumArtifact);
  const deployed = Boolean(binding?.deploymentVerified);
  const funded = Boolean(lastChainState && lastChainState.balanceWei > 0n);
  const eligible = Boolean(lastChainState && lastChainState.secondsUntilEligible === 0);
  const approved = Boolean(lastChainState && lastChainState.approvalCount >= lastChainState.threshold);
  const recovered = Boolean(lastChainState?.recovered);
  const states = [connected, sepolia, policy, compiled, deployed, funded, eligible, approved, recovered];
  const ids = ['runWallet', 'runSepolia', 'runPolicy', 'runCompile', 'runDeploy', 'runFund', 'runEligibility', 'runApprovals', 'runRecovered'];
  const firstIncomplete = states.findIndex(v => !v);
  ids.forEach((id, index) => setRunState(id, states[index], index === firstIncomplete));
}

function renderVault() {
  if (!currentVault) return;
  $('emptyRecovery').classList.add('hidden');
  $('recoveryPanel').classList.remove('hidden');
  $('vaultState').textContent = currentVault.status;
  $('vaultId').textContent = currentVault.id;
  $('policyStage').textContent = currentVault.policyState?.stage ?? currentVault.status;
  $('approvalCount').textContent = `${currentVault.recovery?.approvals?.length || 0} / ${currentVault.threshold}`;
  const remaining = currentVault.policyState?.remainingMs ?? 0;
  $('inactivityState').textContent = currentVault.inactivityEligible ? 'Eligible' : `${Math.ceil(remaining / 86_400_000)} day(s) remaining`;
  $('auditLog').textContent = currentVault.audit.map(x => `${x.at}  ${x.event}${x.actor ? `  ${short(x.actor)}` : ''}${x.txRef ? `  ${short(x.txRef)}` : ''}`).join('\n');
  if (!$('actingContact').value && currentVault.trustedContacts.length) $('actingContact').value = currentVault.trustedContacts[0];
  renderLiveLayer();
}

function renderLiveLayer() {
  const binding = currentVault?.chainBindings?.ethereum;
  const hasVault = Boolean(currentVault);
  const onSepolia = Boolean(walletNetwork?.isSepolia);
  const ownerAuthorized = Boolean(currentVault && permissionHas(currentVault.owner));
  const trustedAuthorized = currentVault ? currentVault.trustedContacts.filter(permissionHas) : [];
  const pending = pendingTrustedContacts();
  const pendingAuthorized = pending.find(permissionHas) ?? null;
  const anySigner = permittedAccounts[0] ?? null;

  $('compileContract').disabled = !hasVault;
  $('switchSepolia').disabled = permittedAccounts.length === 0 || onSepolia;
  $('deployContract').disabled = !hasVault || !ethereumArtifact || Boolean(binding) || !onSepolia || !ownerAuthorized;
  $('liveEmpty').classList.toggle('hidden', hasVault);
  $('livePanel').classList.toggle('hidden', !hasVault);
  $('authorizeRoles').disabled = !hasVault || !chain.available();
  $('syncAccounts').disabled = !chain.available();

  if (!hasVault) {
    renderPermissionSummary();
    renderRunbook();
    return;
  }

  $('corePolicySummary').textContent = `${currentVault.threshold}-of-${currentVault.trustedContacts.length}, ${currentVault.inactivityDays} day core policy`;
  const signerSummary = ownerAuthorized || trustedAuthorized.length
    ? `${ownerAuthorized ? 'Owner' : ''}${ownerAuthorized && trustedAuthorized.length ? ' + ' : ''}${trustedAuthorized.length ? `${trustedAuthorized.length} trusted` : ''} authorized`
    : roleForAccount();
  $('connectedRole').textContent = signerSummary;
  $('sepoliaStatus').textContent = onSepolia ? 'Ready on Sepolia' : permittedAccounts.length ? 'Switch wallet to Sepolia' : 'Authorize wallet';
  renderPermissionSummary();

  if (binding) {
    $('bindingPanel').classList.remove('hidden');
    $('boundContract').textContent = binding.contractRef;
    $('boundNetwork').textContent = binding.networkRef;
    $('boundDeployTx').textContent = binding.deploymentTxRef;
    $('boundTestTimer').textContent = binding.testOnly ? `${binding.testInactivitySeconds}s test-only override` : 'Policy timer';
    $('boundVersion').textContent = binding.contractVersion || '—';
    $('boundAdapterVersion').textContent = binding.adapterVersion || '—';
    $('boundSourceHash').textContent = binding.sourceSha256 || '—';
    $('boundVerification').textContent = binding.deploymentVerified ? 'Runtime + config verified' : 'Not verified';
    $('deployContract').disabled = true;

    $('refreshChainState').disabled = !onSepolia;
    $('depositTestEth').disabled = !ownerAuthorized || !onSepolia || Boolean(lastChainState?.recovered);
    $('fundTrustedContacts').disabled = !ownerAuthorized || !onSepolia || Boolean(lastChainState?.recovered);
    $('chainHeartbeat').disabled = !ownerAuthorized || !onSepolia || Boolean(lastChainState?.recovered);
    $('chainApprove').disabled = !pendingAuthorized || !onSepolia || Boolean(lastChainState?.recovered) || !lastChainState || lastChainState.secondsUntilEligible > 0;
    $('chainExecute').disabled = !anySigner || !onSepolia || !lastChainState || lastChainState.recovered || lastChainState.secondsUntilEligible > 0 || lastChainState.approvalCount < lastChainState.threshold;

    if (!onSepolia) $('roleActionNote').textContent = 'Switch the dapp to Sepolia before any proof-contract action.';
    else if (!ownerAuthorized || trustedAuthorized.length < currentVault.trustedContacts.length) $('roleActionNote').textContent = 'Authorize Owner + trusted contacts once. After that OmegaVault can use the correct signer for each test transaction without disconnecting/reconnecting.';
    else if (lastChainState?.secondsUntilEligible > 0) $('roleActionNote').textContent = `All signing roles are authorized. Wait ${lastChainState.secondsUntilEligible}s for the test inactivity timer.`;
    else if (pendingAuthorized) $('roleActionNote').textContent = `Next approval signer: ${short(pendingAuthorized)}. OmegaVault will request the transaction from that exact authorized account.`;
    else if (lastChainState && lastChainState.approvalCount >= lastChainState.threshold && !lastChainState.recovered) $('roleActionNote').textContent = 'Approval threshold reached. Execute recovery; any authorized signer can submit the transaction.';
    else $('roleActionNote').textContent = 'Live test state is synchronized from Sepolia.';
  } else {
    $('bindingPanel').classList.add('hidden');
    $('deploymentStatus').textContent = 'Not deployed';
  }
  renderRunbook();
}

async function loadLatestVault({ announce = true } = {}) {
  const { vaults } = await api('/api/vaults');
  if (!vaults.length) {
    if (announce) toast('No local OmegaVault policy exists yet.');
    return null;
  }
  const activeId = localStorage.getItem(ACTIVE_VAULT_KEY);
  const active = activeId ? vaults.find(vault => vault.id === activeId) : null;
  const bound = [...vaults].filter(vault => vault.chainBindings?.ethereum?.deploymentVerified)
    .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
  currentVault = active ?? bound ?? [...vaults].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt))).at(-1);
  localStorage.setItem(ACTIVE_VAULT_KEY, currentVault.id);
  lastChainState = null;
  approvalStatuses = [];
  renderVault();
  await loadCapabilityDashboard();
  await refreshWallet({ request: false }).catch(() => {});
  if (announce) toast(currentVault.chainBindings?.ethereum ? 'Existing deployed OmegaVault test resumed.' : 'Latest local OmegaVault policy loaded.');
  return currentVault;
}

$('connectButton').addEventListener('click', () => refreshWallet({ request: true }).catch(e => toast(e.message, 6500)));
$('authorizeRoles').addEventListener('click', () => authorizeTestRoles().catch(e => toast(e.message, 8500)));
$('syncAccounts').addEventListener('click', () => refreshWallet({ request: false }).then(() => toast('Wallet account permissions synchronized.')).catch(e => toast(e.message, 6500)));

$('signProofButton').addEventListener('click', async () => {
  try {
    const proof = await chain.signControlProof(account, nonce());
    $('signatureResult').classList.remove('hidden');
    $('signatureResult').textContent = `Activation message signed locally by wallet. Signature: ${proof.signature}`;
  } catch (e) { toast(e.message, 6500); }
});

$('vaultForm').addEventListener('input', saveDraft);
$('loadLatestVault').addEventListener('click', () => loadLatestVault().catch(e => toast(e.message)));

$('vaultForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const body = {
      chainId: selectedChainId,
      owner: $('owner').value,
      rescueDestination: $('destination').value,
      trustedContacts: $('contacts').value.split(/\n|,/).map(v => v.trim()).filter(Boolean),
      threshold: Number($('threshold').value),
      inactivityDays: Number($('inactivityDays').value)
    };
    const { vault } = await api('/api/vaults', { method: 'POST', body: JSON.stringify(body) });
    currentVault = vault;
    localStorage.setItem(ACTIVE_VAULT_KEY, vault.id);
    lastChainState = null;
    saveDraft();
    renderVault();
    toast('Recovery policy created. Ethereum remains an adapter to this policy.');
  } catch (e) { toast(e.message, 7000); }
});

$('requestRecovery').addEventListener('click', async () => {
  try {
    const { vault } = await api(`/api/vaults/${currentVault.id}/recovery/request`, {
      method: 'POST', body: JSON.stringify({ requester: $('actingContact').value, destination: currentVault.rescueDestination, testMode: true })
    });
    currentVault = vault; renderVault(); toast('Core recovery simulation requested and first approval recorded.');
  } catch (e) { toast(e.message); }
});

$('approveRecovery').addEventListener('click', async () => {
  try {
    const { vault } = await api(`/api/vaults/${currentVault.id}/recovery/approve`, {
      method: 'POST', body: JSON.stringify({ contact: $('actingContact').value })
    });
    currentVault = vault; renderVault(); toast('Core simulation approval processed. Duplicate votes are ignored.');
  } catch (e) { toast(e.message); }
});

$('ownerHeartbeat').addEventListener('click', async () => {
  try {
    const { vault } = await api(`/api/vaults/${currentVault.id}/heartbeat`, {
      method: 'POST', body: JSON.stringify({ owner: currentVault.owner })
    });
    currentVault = vault; renderVault(); toast('Core heartbeat recorded. Pending simulated recovery cleared.');
  } catch (e) { toast(e.message); }
});

$('compileContract').addEventListener('click', () => compileEthereumContract().catch(e => {
  $('compilerStatus').textContent = 'Compilation failed';
  toast(e.message, 7000);
}));

$('switchSepolia').addEventListener('click', async () => {
  try {
    await chain.switchToSepolia();
    await refreshWallet({ request: false });
    toast('Wallet switched to Sepolia.');
  } catch (e) { toast(e.message, 6500); }
});

$('deployContract').addEventListener('click', async () => {
  const button = $('deployContract');
  setBusy(button, true, 'Confirm deployment…');
  try {
    const artifact = await compileEthereumContract();
    const seconds = Number($('testInactivitySeconds').value);
    if (!Number.isInteger(seconds) || seconds < 15 || seconds > 86400) throw new Error('Test inactivity must be between 15 seconds and 24 hours.');
    const deployment = await chain.deployRecoveryVault({ artifact, policy: currentVault, inactivitySeconds: seconds });
    $('deploymentStatus').textContent = `Mined ${short(deployment.txHash)} · verifying…`;

    const verification = await chain.verifyDeployment({
      contractAddress: deployment.contractAddress,
      artifact,
      policy: currentVault,
      inactivitySeconds: seconds
    });
    if (!verification.verified) {
      const failed = Object.entries(verification.checks).filter(([, ok]) => !ok).map(([name]) => name).join(', ');
      throw new Error(`Deployment mined but verification failed: ${failed}. The contract was NOT bound to OmegaVault Core.`);
    }

    const meta = ethereumContractMeta ?? await api('/api/ethereum/contract-source');
    const { vault } = await api(`/api/vaults/${currentVault.id}/chain/bind`, {
      method: 'POST',
      body: JSON.stringify({
        chainId: 'ethereum',
        networkRef: deployment.network.id,
        contractRef: deployment.contractAddress,
        deploymentTxRef: deployment.txHash,
        testOnly: true,
        testInactivitySeconds: seconds,
        adapterVersion: chain.version,
        contractVersion: meta.contractVersion,
        sourceSha256: meta.sourceSha256,
        deploymentVerified: true,
        verification: { checks: verification.checks, contactChecks: verification.contactChecks }
      })
    });
    currentVault = vault;
    lastChainState = verification.state;
    $('deploymentStatus').textContent = `Verified: ${short(deployment.contractAddress)}`;
    renderVault();
    renderChainState(verification.state);
    toast('Ethereum proof contract deployed, runtime/config verified, and bound to the neutral OmegaVault record.', 7500);
  } catch (e) {
    toast(e.message, 8500);
  } finally {
    setBusy(button, false);
    renderLiveLayer();
  }
});

async function recordChain(operation, result, proof) {
  const { vault } = await api(`/api/vaults/${currentVault.id}/chain/activity`, {
    method: 'POST',
    body: JSON.stringify({
      chainId: 'ethereum', operation, actor: result.actor, txRef: result.txHash, proof
    })
  });
  currentVault = vault;
  renderVault();
}


function serializableChainState(state) {
  if (!state) return null;
  return {
    ...state,
    balanceWei: state.balanceWei?.toString?.() ?? String(state.balanceWei ?? '0'),
    code: undefined
  };
}

function exportTestEvidence() {
  if (!currentVault) return toast('Create or load an OmegaVault policy before exporting evidence.');
  const evidence = {
    format: 'OmegaVault-test-evidence/0.3',
    generatedAt: new Date().toISOString(),
    app: {
      version: appConfig?.appVersion ?? '0.4.3',
      mode: appConfig?.mode ?? 'test-proof',
      mainnetTransactionsEnabled: appConfig?.mainnetTransactionsEnabled ?? false
    },
    walletObservation: {
      connectedAccount: account,
      authorizedAccounts: permittedAccounts,
      network: walletNetwork
    },
    vault: currentVault,
    onChainState: serializableChainState(lastChainState)
  };
  const blob = new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `omegavault-test-evidence-${currentVault.id}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Test evidence exported as JSON.');
}

function renderChainState(state) {
  lastChainState = state;
  $('chainOwner').textContent = short(state.owner);
  $('chainDestination').textContent = short(state.rescueDestination);
  $('chainApprovalCount').textContent = `${state.approvalCount} / ${state.threshold}`;
  if ($('chainApprovalDetail')) $('chainApprovalDetail').textContent = approvalStatuses.length ? approvalStatuses.map((item, index) => `${item.approved ? '✓' : '○'} ${String.fromCharCode(65 + index)} ${short(item.contact)}`).join('   ') : 'Approval details not read yet.';
  if ($('contactGasStatus')) $('contactGasStatus').textContent = contactBalances.length ? contactBalances.map((item, index) => `${String.fromCharCode(65 + index)} ${short(item.contact)}: ${formatEth(item.balanceWei)}`).join('   ') : 'Contact gas balances not read yet.';
  $('chainEligibility').textContent = state.secondsUntilEligible === 0 ? 'Eligible now' : `${state.secondsUntilEligible}s remaining`;
  $('chainRecovered').textContent = state.recovered ? 'Recovered' : 'Active';
  $('chainBalance').textContent = formatEth(state.balanceWei);
  $('chainInactivityPeriod').textContent = `${state.inactivityPeriod}s`;
  $('chainAdapterVersion').textContent = String(state.adapterVersion);
  $('chainHeartbeatAt').textContent = new Date(state.lastHeartbeat * 1000).toLocaleString();
  renderLiveLayer();
}

async function refreshOnChainState() {
  const binding = currentVault?.chainBindings?.ethereum;
  if (!binding) throw new Error('Deploy and bind the Sepolia proof contract first.');
  const artifact = await compileEthereumContract();
  const network = await chain.network();
  walletNetwork = network;
  if (network.id !== binding.networkRef) throw new Error(`Wallet is on ${network.label}; switch back to the network used by this binding.`);
  const state = await chain.readRecoveryState({ contractAddress: binding.contractRef, artifact });
  approvalStatuses = await chain.readApprovalStatuses({ contractAddress: binding.contractRef, artifact, contacts: currentVault.trustedContacts });
  contactBalances = await Promise.all(currentVault.trustedContacts.map(async contact => ({ contact, balanceWei: await chain.readNativeBalanceWei(contact) })));
  state.approvalStatuses = approvalStatuses;
  state.contactBalances = contactBalances.map(item => ({ contact: item.contact, balanceWei: item.balanceWei.toString() }));
  renderChainState(state);
  return state;
}

$('provenanceAuditExport')?.addEventListener('click', () => {
  try {
    const jsonText = serializeValidatedProvenanceAudit(provenanceAuditUiModel);
    const blob = new Blob([jsonText], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `omegavault-provenance-integrity-audit-${provenanceAuditUiModel.audit.sha256.slice(0, 12)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Backend-validated provenance audit exported as JSON.');
  } catch (error) {
    toast(error.message, 8500);
  }
});

$('exportEvidence').addEventListener('click', exportTestEvidence);

$('refreshChainState').addEventListener('click', async () => {
  const b = $('refreshChainState'); setBusy(b, true, 'Reading chain…');
  try { await refreshOnChainState(); toast('On-chain Sepolia state refreshed.'); }
  catch (e) { toast(e.message, 6500); }
  finally { setBusy(b, false); renderLiveLayer(); }
});

$('depositTestEth').addEventListener('click', async () => {
  const b = $('depositTestEth'); setBusy(b, true, 'Confirm deposit…');
  try {
    const binding = currentVault.chainBindings.ethereum;
    const amount = $('depositAmount').value;
    const result = await chain.depositTestEth({ contractAddress: binding.contractRef, amountEth: amount, actor: currentVault.owner });
    await recordChain('deposit', result, { amountEth: amount, amountWei: result.amountWei.toString() });
    await refreshOnChainState();
    toast('Sepolia test ETH deposited into the proof vault.');
  } catch (e) { toast(e.message, 7500); }
  finally { setBusy(b, false); renderLiveLayer(); }
});

$('fundTrustedContacts').addEventListener('click', async () => {
  const b = $('fundTrustedContacts');
  const status = $('contactFundingStatus');
  setBusy(b, true, 'Funding contacts…');
  try {
    if (!currentVault || !permissionHas(currentVault.owner)) throw new Error('Authorize the configured Owner account first.');
    const target = $('contactFundingAmount').value;
    let sent = 0;
    let already = 0;
    for (let i = 0; i < currentVault.trustedContacts.length; i += 1) {
      const recipient = currentVault.trustedContacts[i];
      status.textContent = `Contact ${i + 1}/${currentVault.trustedContacts.length}: checking ${short(recipient)}…`;
      const result = await chain.topUpTestAccount({ to: recipient, targetEth: target, actor: currentVault.owner });
      if (result.skipped) {
        already += 1;
        status.textContent = `Contact ${i + 1}: already has at least ${target} Sepolia ETH.`;
        continue;
      }
      status.textContent = `Contact ${i + 1}: confirm ${formatEth(result.amountWei)} top-up in MetaMask.`;
      await recordChain('test.contact.funded', result, { recipient: result.recipient, targetEth: target, amountWei: result.amountWei.toString() });
      sent += 1;
      status.textContent = `Confirmed ${i + 1}/${currentVault.trustedContacts.length}: ${short(result.txHash)}`;
    }
    status.textContent = `Gas prep complete: ${sent} transfer(s) sent, ${already} contact(s) already funded.`;
    toast('Trusted-contact gas preparation complete. No account switching is required if the test roles are authorized.', 7500);
  } catch (e) {
    status.textContent = `Stopped: ${e.message}`;
    toast(e.message, 8500);
  } finally {
    setBusy(b, false);
    renderLiveLayer();
  }
});

async function runContractAction(signature, operation, buttonId, label, actor) {
  const button = $(buttonId); setBusy(button, true, 'Confirm in wallet…');
  try {
    const binding = currentVault.chainBindings.ethereum;
    const artifact = await compileEthereumContract();
    const result = await chain.sendContractAction({ contractAddress: binding.contractRef, artifact, signature, actor });
    await recordChain(operation, result, { signerRole: roleForAccount(actor) });
    await refreshOnChainState();
    toast(label, 6500);
  } catch (e) { toast(e.message, 8000); }
  finally { setBusy(button, false); renderLiveLayer(); }
}

$('chainHeartbeat').addEventListener('click', () => runContractAction('heartbeat()', 'heartbeat', 'chainHeartbeat', 'On-chain owner heartbeat confirmed; any existing approvals were cleared.', currentVault.owner));
$('chainApprove').addEventListener('click', () => {
  const actor = pendingTrustedContacts().find(permissionHas);
  if (!actor) return toast('No pending trusted-contact signer is currently authorized. Use Authorize test roles once.', 7500);
  return runContractAction('approveRecovery()', 'recovery.approved', 'chainApprove', `Trusted-contact approval confirmed from ${short(actor)}.`, actor);
});
$('chainExecute').addEventListener('click', () => {
  const actor = permissionHas(currentVault.owner) ? currentVault.owner : permittedAccounts[0];
  if (!actor) return toast('Authorize at least one signing account before executing recovery.', 6500);
  return runContractAction('executeRecovery()', 'recovery.executed', 'chainExecute', 'Recovery execution confirmed on Sepolia. Refresh the rescue wallet to verify receipt.', actor);
});

chain.onAccountChanged(() => refreshWallet({ request: false }).then(() => currentVault?.chainBindings?.ethereum ? refreshOnChainState().catch(() => {}) : null).catch(() => {}));
chain.onNetworkChanged(() => refreshWallet({ request: false }).then(() => currentVault?.chainBindings?.ethereum ? refreshOnChainState().catch(() => {}) : null).catch(() => {}));

async function init() {
  restoreDraft();
  try {
    appConfig = await api('/api/config');
    $('runtimePill').textContent = `${appConfig.mode.toUpperCase()} · ${appConfig.ethereumProof.allowedNetwork.name.toUpperCase()} ONLY`;
    $('footerVersion').textContent = `OmegaVault MVP ${appConfig.appVersion}`;
  } catch (e) {
    toast(`Unable to read OmegaVault runtime configuration: ${e.message}`, 7000);
  }

  await loadCapabilityDashboard();
  await refreshWallet({ request: false }).catch(() => {});
  await loadLatestVault({ announce: false }).catch(() => {});
  if (currentVault?.chainBindings?.ethereum && walletNetwork?.isSepolia) {
    await refreshOnChainState().catch(() => {});
  }
  renderLiveLayer();
}

init();
