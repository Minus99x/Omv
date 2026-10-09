import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ETH_ADDRESS=/^0x[0-9a-f]{40}$/i;
const ETH_TX=/^0x[0-9a-f]{64}$/i;
const SHA256=/^[0-9a-f]{64}$/i;

function argValue(name){
  const index=process.argv.indexOf(name);
  return index>=0 ? process.argv[index+1] : null;
}

function normalizeAddress(value){
  return typeof value==='string' && ETH_ADDRESS.test(value) ? value.toLowerCase() : null;
}

function normalizeTx(value){
  return typeof value==='string' && ETH_TX.test(value) ? value.toLowerCase() : null;
}

function normalizeSha(value){
  return typeof value==='string' && SHA256.test(value) ? value.toLowerCase() : null;
}

function loadVaultStore(file){
  const raw=fs.readFileSync(file,'utf8');
  const parsed=JSON.parse(raw);
  if(!parsed || !Array.isArray(parsed.vaults)) throw new Error('Vault store must contain a vaults array.');
  return parsed.vaults;
}

function latestActivity(vault,operation){
  return [...(vault.chainActivity ?? [])]
    .filter(item=>item?.chainId==='ethereum' && item?.operation===operation && normalizeTx(item?.txRef))
    .sort((a,b)=>String(a?.at ?? '').localeCompare(String(b?.at ?? '')))
    .at(-1) ?? null;
}

export function extractEthereumSepoliaLegacyProofCandidates(vaults){
  if(!Array.isArray(vaults)) throw new TypeError('vaults must be an array.');
  const candidates=[];

  for(const vault of vaults){
    const binding=vault?.chainBindings?.ethereum;
    if(!binding || binding.deploymentVerified!==true) continue;
    if(binding.networkRef!=='0xaa36a7' && binding.networkRef!=='ethereum:sepolia') continue;

    const contractAddress=normalizeAddress(binding.contractRef);
    const deploymentTxHash=normalizeTx(binding.deploymentTxRef);
    const sourceSha256=normalizeSha(binding.sourceSha256);
    if(!contractAddress || !deploymentTxHash) continue;

    const nativeRecovery=latestActivity(vault,'recovery.executed');
    const deployment=latestActivity(vault,'deployment');
    const heartbeat=latestActivity(vault,'heartbeat');
    const approvals=(vault.chainActivity ?? [])
      .filter(item=>item?.chainId==='ethereum' && item?.operation==='recovery.approved' && normalizeTx(item?.txRef))
      .map(item=>Object.freeze({
        at:item.at ?? null,
        actor:normalizeAddress(item.actor),
        txHash:normalizeTx(item.txRef)
      }));

    candidates.push(Object.freeze({
      vaultId:String(vault.id ?? ''),
      createdAt:vault.createdAt ?? null,
      owner:normalizeAddress(vault.owner),
      rescueDestination:normalizeAddress(vault.rescueDestination),
      trustedContacts:Object.freeze((vault.trustedContacts ?? []).map(normalizeAddress).filter(Boolean)),
      threshold:Number.isInteger(vault.threshold) ? vault.threshold : null,
      inactivityDays:Number.isInteger(vault.inactivityDays) ? vault.inactivityDays : null,
      binding:Object.freeze({
        networkRef:binding.networkRef,
        contractAddress,
        deploymentTxHash,
        deploymentActivityTxHash:normalizeTx(deployment?.txRef),
        adapterVersion:binding.adapterVersion ?? null,
        contractVersion:binding.contractVersion ?? null,
        sourceSha256,
        testInactivitySeconds:Number.isInteger(binding.testInactivitySeconds) ? binding.testInactivitySeconds : null,
        boundAt:binding.boundAt ?? null
      }),
      publicProofIdentifiers:Object.freeze({
        deploymentTxHash,
        nativeRecoveryTxHash:normalizeTx(nativeRecovery?.txRef),
        heartbeatTxHash:normalizeTx(heartbeat?.txRef),
        approvalTxHashes:Object.freeze(approvals.map(item=>item.txHash)),
        approvalActors:Object.freeze(approvals.map(item=>item.actor))
      }),
      migrationReadiness:Object.freeze({
        deploymentRebindCandidate:Boolean(contractAddress && deploymentTxHash && sourceSha256),
        nativeRecoveryRebindCandidate:Boolean(nativeRecovery?.txRef),
        thresholdEvidenceIdentifiersPresent:approvals.length>0,
        heartbeatEvidenceIdentifierPresent:Boolean(heartbeat?.txRef),
        tokenRecoveryIdentifierPresent:false
      })
    }));
  }

  return Object.freeze(candidates.sort((a,b)=>String(a.createdAt ?? '').localeCompare(String(b.createdAt ?? ''))));
}

export function summarizeEthereumSepoliaLegacyProofCandidates(candidates){
  if(!Array.isArray(candidates)) throw new TypeError('candidates must be an array.');
  const latest=candidates.at(-1) ?? null;
  return Object.freeze({
    schema:'omegavault.ethereum-sepolia-legacy-identifier-inspection.v1',
    readOnly:true,
    candidateCount:candidates.length,
    latest,
    candidates:Object.freeze(candidates),
    authorityBoundary:'This inspection reads local OmegaVault test metadata only. It does not access wallet keys, sign transactions, query Sepolia, submit transactions, or promote Ethereum support.'
  });
}

if(process.argv[1] && import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href){
  const file=path.resolve(argValue('--vault-store') ?? path.join(os.homedir(),'.omegavault-test','vaults.json'));
  if(!fs.existsSync(file)){
    console.error(JSON.stringify({
      ok:false,
      error:'OmegaVault vault store not found.',
      path:file,
      hint:'Use --vault-store <path> if the migrated 0.4.x vault file is elsewhere.'
    },null,2));
    process.exitCode=1;
  }else{
    try{
      const candidates=extractEthereumSepoliaLegacyProofCandidates(loadVaultStore(file));
      console.log(JSON.stringify({
        ok:true,
        path:file,
        ...summarizeEthereumSepoliaLegacyProofCandidates(candidates)
      },null,2));
    }catch(error){
      console.error(JSON.stringify({ ok:false,error:String(error?.message || error),path:file },null,2));
      process.exitCode=1;
    }
  }
}
