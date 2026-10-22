import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyBitcoinSignetObservationArtifact, verifyBitcoinSignetObservationFreshness } from '../src/chains/bitcoin/signet-evidence.js';

// Offline consistency validation only. Does not authenticate RPC provenance.
const allowed = new Set(['--evidence','--finalizer','--final-transaction','--max-age-seconds']);
const args = new Map();
for(let i=2;i<process.argv.length;){
  const flag=process.argv[i++];
  if(!allowed.has(flag) || args.has(flag) || i>=process.argv.length ||
      process.argv[i].startsWith('--')){
    throw new Error('Unsupported, duplicate, missing or unsafe Bitcoin artifact option: '+flag);
  }
  args.set(flag,process.argv[i++]);
}
for(const field of ['--evidence','--finalizer','--final-transaction']){
  if(!args.get(field))throw new TypeError('Required Bitcoin artifact option: '+field);
}
const evidence=JSON.parse(readFileSync(resolve(args.get('--evidence')),'utf8'));
const finalizerEvidence=JSON.parse(readFileSync(resolve(args.get('--finalizer')),'utf8'));
const finalTransactionEvidence=JSON.parse(readFileSync(resolve(args.get('--final-transaction')),'utf8'));
const result=verifyBitcoinSignetObservationArtifact({
  evidence,finalizerEvidence,finalTransactionEvidence
});
if(result.ok && args.has('--max-age-seconds')) {
  const seconds=args.get('--max-age-seconds');
  if(!/^(0|[1-9]\d*)$/.test(seconds) || !Number.isSafeInteger(Number(seconds)) ||
     Number(seconds)>Math.floor(Number.MAX_SAFE_INTEGER/1000)) {
    throw new TypeError('max-age-seconds must be a non-negative, exact integer number of seconds.');
  }
  const freshness=verifyBitcoinSignetObservationFreshness({
    evidence,now:new Date().toISOString(),maxAgeMs:Number(seconds)*1000
  });
  if(!freshness.ok) {
    process.stderr.write('BITCOIN_SIGNET_ARTIFACT_INVALID '+freshness.errors.join('; ')+'\n');
    process.exitCode=1;
  }
}
if(!result.ok){
  process.stderr.write('BITCOIN_SIGNET_ARTIFACT_INVALID '+result.errors.join('; ')+'\n');
  process.exitCode=1;
}else if (process.exitCode !== 1){
  process.stdout.write('BITCOIN_SIGNET_ARTIFACT_VALID '+evidence.sha256+'\n');
}
