import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractEthereumSepoliaLegacyProofCandidates,
  summarizeEthereumSepoliaLegacyProofCandidates
} from '../scripts/inspect-ethereum-sepolia-legacy-proof.js';

const owner='0x'+'11'.repeat(20);
const rescue='0x'+'22'.repeat(20);
const contact='0x'+'33'.repeat(20);
const contract='0x'+'44'.repeat(20);
const deployTx='0x'+'aa'.repeat(32);
const heartbeatTx='0x'+'bb'.repeat(32);
const approvalTx='0x'+'cc'.repeat(32);
const executeTx='0x'+'dd'.repeat(32);
const sourceSha='ee'.repeat(32);

function vault(){
  return {
    id:'vault-1',
    createdAt:'2026-01-01T00:00:00.000Z',
    owner,
    rescueDestination:rescue,
    trustedContacts:[contact],
    threshold:1,
    inactivityDays:30,
    chainBindings:{
      ethereum:{
        networkRef:'0xaa36a7',
        contractRef:contract,
        deploymentTxRef:deployTx,
        deploymentVerified:true,
        adapterVersion:'0.4.0',
        contractVersion:'0.4.0',
        sourceSha256:sourceSha,
        testInactivitySeconds:60,
        boundAt:'2026-01-01T00:10:00.000Z'
      }
    },
    chainActivity:[
      { at:'2026-01-01T00:10:00.000Z',chainId:'ethereum',operation:'deployment',actor:owner,txRef:deployTx },
      { at:'2026-01-01T00:20:00.000Z',chainId:'ethereum',operation:'heartbeat',actor:owner,txRef:heartbeatTx },
      { at:'2026-01-01T00:30:00.000Z',chainId:'ethereum',operation:'recovery.approved',actor:contact,txRef:approvalTx },
      { at:'2026-01-01T00:40:00.000Z',chainId:'ethereum',operation:'recovery.executed',actor:owner,txRef:executeTx }
    ]
  };
}

test('legacy Sepolia inspector extracts only migration-relevant public identifiers',()=>{
  const candidates=extractEthereumSepoliaLegacyProofCandidates([vault()]);
  assert.equal(candidates.length,1);
  const candidate=candidates[0];
  assert.equal(candidate.binding.contractAddress,contract);
  assert.equal(candidate.binding.deploymentTxHash,deployTx);
  assert.equal(candidate.binding.sourceSha256,sourceSha);
  assert.equal(candidate.publicProofIdentifiers.nativeRecoveryTxHash,executeTx);
  assert.equal(candidate.publicProofIdentifiers.heartbeatTxHash,heartbeatTx);
  assert.deepEqual(candidate.publicProofIdentifiers.approvalTxHashes,[approvalTx]);
  assert.equal(candidate.migrationReadiness.deploymentRebindCandidate,true);
  assert.equal(candidate.migrationReadiness.nativeRecoveryRebindCandidate,true);
  assert.equal(candidate.migrationReadiness.thresholdEvidenceIdentifiersPresent,true);
});

test('legacy Sepolia inspector ignores unverified or non-Sepolia bindings',()=>{
  const unverified=vault();
  unverified.chainBindings.ethereum.deploymentVerified=false;
  const wrongNetwork=vault();
  wrongNetwork.id='vault-2';
  wrongNetwork.chainBindings.ethereum.networkRef='0x1';
  assert.deepEqual(extractEthereumSepoliaLegacyProofCandidates([unverified,wrongNetwork]),[]);
});

test('legacy Sepolia inspector does not invent missing recovery identifiers',()=>{
  const value=vault();
  value.chainActivity=value.chainActivity.filter(item=>item.operation!=='recovery.executed');
  const [candidate]=extractEthereumSepoliaLegacyProofCandidates([value]);
  assert.equal(candidate.publicProofIdentifiers.nativeRecoveryTxHash,null);
  assert.equal(candidate.migrationReadiness.nativeRecoveryRebindCandidate,false);
  assert.equal(candidate.migrationReadiness.tokenRecoveryIdentifierPresent,false);
});

test('legacy Sepolia inspection summary remains explicitly read-only',()=>{
  const candidates=extractEthereumSepoliaLegacyProofCandidates([vault()]);
  const summary=summarizeEthereumSepoliaLegacyProofCandidates(candidates);
  assert.equal(summary.readOnly,true);
  assert.equal(summary.candidateCount,1);
  assert.match(summary.authorityBoundary,/does not access wallet keys/i);
});
