#!/usr/bin/env node
/**
 * Fixed V0.5.1 candidate read-only deployment simulation on XDC Apothem.
 * No keys, funding, signed transactions, or broadcast.
 * V0.5 estimate MUST NOT be used for this changed contract source.
 */
import { pathToFileURL } from 'node:url';
import {inspectXdcApothemDeployment} from './xdc-apothem-deployment-preflight.js';

export async function inspectV051Candidate({fetchImpl=globalThis.fetch}={}){
 const report=await inspectXdcApothemDeployment({fetchImpl,variant:'V051'});
 if(report.contractName!=='OmegaVaultRecoveryVaultV051'||
    report.contractVariant!=='V051'||report.networkRef!=='xdc:apothem'||
    report.bothProvidersEstimatedGas!==true||report.withinFeeCap!==true||
    report.simulationReadyWithinFiveFakeXdc!==true){
   throw new Error('V0.5.1 candidate Apothem simulation did not clear strict independent estimates and 5 fake TXDC limit.');
 }
 return Object.freeze({...report,preflightCandidate:'V0.5.1',
   liveApothemRpcObserved:true,liveApothemDeploymentPerformed:false,
   customerWalletsUsed:false,authorizedToDeploy:false});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 inspectV051Candidate().then(x=>console.log(JSON.stringify(x,null,2)))
  .catch(e=>{console.error('XDC_V051_DEPLOYMENT_PREFLIGHT_BLOCKED:',String(e?.message??e));process.exitCode=1;});
}
