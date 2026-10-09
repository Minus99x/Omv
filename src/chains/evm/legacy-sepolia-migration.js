import { PROMOTION_GATES } from '../maturity.js';

const HEX_64=/^[0-9a-f]{64}$/i;
const EVM_ADDRESS=/^0x[0-9a-f]{40}$/i;
const EVM_TX=/^0x[0-9a-f]{64}$/i;

const OFFLINE_REVALIDATABLE=new Set([
  'network-profile',
  'address-validation',
  'transaction-preflight',
  'adversarial-tests',
  'evidence-export',
  'threat-review'
]);

const PUBLIC_NETWORK_GATES=new Set([
  'wallet-signing',
  'mechanism-create',
  'mechanism-verify',
  'inactivity-semantics',
  'threshold-semantics',
  'immutable-rescue-semantics',
  'native-asset-recovery',
  'token-recovery',
  'fee-finality-model'
]);

function maybeHex64(value){ return typeof value==='string' && HEX_64.test(value); }
function maybeAddress(value){ return typeof value==='string' && EVM_ADDRESS.test(value); }
function maybeTx(value){ return typeof value==='string' && EVM_TX.test(value); }

function legacyIdentity(input={}){
  return Object.freeze({
    contractAddress:maybeAddress(input.contractAddress) ? input.contractAddress.toLowerCase() : null,
    deploymentTxHash:maybeTx(input.deploymentTxHash) ? input.deploymentTxHash.toLowerCase() : null,
    nativeRecoveryTxHash:maybeTx(input.nativeRecoveryTxHash) ? input.nativeRecoveryTxHash.toLowerCase() : null,
    tokenRecoveryTxHash:maybeTx(input.tokenRecoveryTxHash) ? input.tokenRecoveryTxHash.toLowerCase() : null,
    sourceSha256:maybeHex64(input.sourceSha256) ? input.sourceSha256.toLowerCase() : null,
    archiveSha256:maybeHex64(input.archiveSha256) ? input.archiveSha256.toLowerCase() : null
  });
}

function gateStatus(gate,identity){
  if(OFFLINE_REVALIDATABLE.has(gate)){
    return Object.freeze({
      gate,
      classification:'revalidate-current-code',
      legacyProofCanAutoPass:false,
      freshPublicTransactionRequired:false,
      reason:'This gate can be re-established from the current 0.6 source/offline evidence model without treating legacy status as current proof.'
    });
  }

  if(PUBLIC_NETWORK_GATES.has(gate)){
    const txAvailable=
      gate==='mechanism-create' ? Boolean(identity.deploymentTxHash && identity.contractAddress) :
      gate==='token-recovery' ? Boolean(identity.tokenRecoveryTxHash && identity.contractAddress) :
      gate==='native-asset-recovery' || gate==='fee-finality-model' || gate==='mechanism-verify' ||
      gate==='inactivity-semantics' || gate==='threshold-semantics' || gate==='immutable-rescue-semantics' ||
      gate==='wallet-signing'
        ? Boolean(identity.nativeRecoveryTxHash && identity.contractAddress)
        : false;

    return Object.freeze({
      gate,
      classification:txAvailable ? 'legacy-public-proof-rebind-candidate' : 'fresh-public-proof-required',
      legacyProofCanAutoPass:false,
      freshPublicTransactionRequired:!txAvailable,
      reason:txAvailable
        ? 'Legacy Sepolia identifiers may be re-observed and rebound into 0.6 evidence schemas, but the legacy claim itself cannot satisfy the gate.'
        : 'The legacy record lacks enough exact public-network identity to rebind this gate; a fresh Sepolia proof is required.'
    });
  }

  return Object.freeze({
    gate,
    classification:'manual-review',
    legacyProofCanAutoPass:false,
    freshPublicTransactionRequired:false,
    reason:'Gate requires explicit migration review.'
  });
}

export function createEthereumSepoliaLegacyMigrationPlan({ legacyEvidence={} }={}){
  const identity=legacyIdentity(legacyEvidence);
  const gates=Object.freeze(Object.fromEntries(
    PROMOTION_GATES.map(gate=>[gate,gateStatus(gate,identity)])
  ));

  const rebindCandidates=Object.freeze(
    PROMOTION_GATES.filter(gate=>gates[gate].classification==='legacy-public-proof-rebind-candidate')
  );
  const freshPublicProofRequired=Object.freeze(
    PROMOTION_GATES.filter(gate=>gates[gate].freshPublicTransactionRequired===true)
  );
  const offlineRevalidation=Object.freeze(
    PROMOTION_GATES.filter(gate=>gates[gate].classification==='revalidate-current-code')
  );

  return Object.freeze({
    schema:'omegavault.ethereum-sepolia-legacy-migration-plan.v1',
    chainId:'ethereum',
    networkRef:'ethereum:sepolia',
    sourceStage:'legacy-live-proof',
    targetEvidenceContract:'omegavault.chain-capability-contract.v1',
    legacyIdentity:identity,
    gates,
    rebindCandidates,
    freshPublicProofRequired,
    offlineRevalidation,
    automaticPromotionAuthorized:false,
    targetStageAfterPlan:'legacy-live-proof',
    promotionRequiresCurrentEvidenceContract:true,
    authorityBoundary:'Historical Sepolia live proof is preserved as provenance. It may reduce duplicated public-network work only when exact legacy contract/transaction identities can be independently re-observed and rebound into current evidence schemas. No historical label auto-passes a 0.6 promotion gate.'
  });
}

export function assertEthereumLegacyMigrationCannotAutoPromote(plan){
  if(!plan || plan.schema!=='omegavault.ethereum-sepolia-legacy-migration-plan.v1') {
    throw new TypeError('Ethereum Sepolia legacy migration plan is required.');
  }
  if(plan.automaticPromotionAuthorized!==false) {
    throw new Error('Legacy Ethereum proof must not authorize automatic support promotion.');
  }
  if(Object.values(plan.gates ?? {}).some(gate=>gate?.legacyProofCanAutoPass===true)) {
    throw new Error('A legacy Ethereum gate was incorrectly allowed to auto-pass.');
  }
  return true;
}
