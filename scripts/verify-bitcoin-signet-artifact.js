import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyBitcoinSignetObservationArtifact } from '../src/chains/bitcoin/signet-evidence.js';

// Offline consistency validation only. Does not authenticate RPC provenance.
const allowed = new Set(['--evidence','--finalizer','--final-transaction']);
const args = new Map();
for(let i=2;i<process.argv.length;){
  const flag=process.argv[i++];
  if(!allowed.has(flag) || args.has(flag) || i>=process.argv.length ||
      process.argv[i].startsWith('--')){
    throw new Error('Unsupported, duplicate, missing or unsafe Bitcoin artifact option: '+flag);
  }
  args.set(flag,process.argv[i++]);
}
for(const field of allowed){
  if(!args.get(field))throw new TypeError('Required Bitcoin artifact option: '+field);
}
const evidence=JSON.parse(readFileSync(resolve(args.get('--evidence')),'utf8'));
const finalizerEvidence=JSON.parse(readFileSync(resolve(args.get('--finalizer')),'utf8'));
const finalTransactionEvidence=JSON.parse(readFileSync(resolve(args.get('--final-transaction')),'utf8'));
const result=verifyBitcoinSignetObservationArtifact({
  evidence,finalizerEvidence,finalTransactionEvidence
});
if(!result.ok){
  process.stderr.write('BITCOIN_SIGNET_ARTIFACT_INVALID '+result.errors.join('; ')+'\n');
  process.exitCode=1;
}else{
  process.stdout.write('BITCOIN_SIGNET_ARTIFACT_VALID '+evidence.sha256+'\n');
}
