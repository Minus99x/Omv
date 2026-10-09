import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEthereumSepoliaLegacyMigrationPlan,
  assertEthereumLegacyMigrationCannotAutoPromote
} from '../src/chains/evm/legacy-sepolia-migration.js';

test('Ethereum legacy Sepolia proof never auto-passes 0.6 evidence gates',()=>{
  const plan=createEthereumSepoliaLegacyMigrationPlan({
    legacyEvidence:{
      contractAddress:'0x'+'11'.repeat(20),
      deploymentTxHash:'0x'+'aa'.repeat(32),
      nativeRecoveryTxHash:'0x'+'bb'.repeat(32),
      tokenRecoveryTxHash:'0x'+'cc'.repeat(32),
      sourceSha256:'dd'.repeat(32),
      archiveSha256:'ee'.repeat(32)
    }
  });
  assert.equal(plan.sourceStage,'legacy-live-proof');
  assert.equal(plan.automaticPromotionAuthorized,false);
  assert.equal(plan.promotionRequiresCurrentEvidenceContract,true);
  assert.ok(plan.rebindCandidates.includes('mechanism-create'));
  assert.ok(plan.rebindCandidates.includes('native-asset-recovery'));
  assert.ok(plan.rebindCandidates.includes('token-recovery'));
  assert.ok(plan.offlineRevalidation.includes('adversarial-tests'));
  assert.equal(assertEthereumLegacyMigrationCannotAutoPromote(plan),true);
  for(const gate of Object.values(plan.gates)) assert.equal(gate.legacyProofCanAutoPass,false);
});

test('Ethereum legacy proof with missing exact transaction identity requires fresh public proof',()=>{
  const plan=createEthereumSepoliaLegacyMigrationPlan({
    legacyEvidence:{
      contractAddress:'0x'+'11'.repeat(20)
    }
  });
  assert.ok(plan.freshPublicProofRequired.includes('mechanism-create'));
  assert.ok(plan.freshPublicProofRequired.includes('native-asset-recovery'));
  assert.ok(plan.freshPublicProofRequired.includes('token-recovery'));
  assert.ok(plan.freshPublicProofRequired.includes('fee-finality-model'));
});

test('Ethereum legacy proof rebind candidate still requires independent 0.6 evidence construction',()=>{
  const plan=createEthereumSepoliaLegacyMigrationPlan({
    legacyEvidence:{
      contractAddress:'0x'+'11'.repeat(20),
      deploymentTxHash:'0x'+'aa'.repeat(32),
      nativeRecoveryTxHash:'0x'+'bb'.repeat(32)
    }
  });
  assert.equal(plan.gates['mechanism-create'].classification,'legacy-public-proof-rebind-candidate');
  assert.equal(plan.gates['fee-finality-model'].classification,'legacy-public-proof-rebind-candidate');
  assert.equal(plan.gates['token-recovery'].classification,'fresh-public-proof-required');
  assert.match(plan.authorityBoundary,/re-observed and rebound/i);
});

test('Ethereum current source/offline gates are revalidated instead of inherited from 0.4.3 status',()=>{
  const plan=createEthereumSepoliaLegacyMigrationPlan();
  for(const gate of ['network-profile','address-validation','transaction-preflight','adversarial-tests','evidence-export','threat-review']){
    assert.equal(plan.gates[gate].classification,'revalidate-current-code');
    assert.equal(plan.gates[gate].legacyProofCanAutoPass,false);
  }
});
