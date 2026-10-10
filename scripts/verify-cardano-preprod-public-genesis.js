// Public read-only Preprod genesis provenance check. No secrets, ledger RPC,
// wallet connection, signing, broadcast or write to network state.
import { verifyCardanoPreprodGenesisTiming } from '../src/chains/cardano/preprod-genesis-timing.js';

const ORIGIN='https://book.world.dev.cardano.org/environments/preprod';
async function published(name) {
  const response=await fetch(ORIGIN+'/'+name,{
    method:'GET',
    signal:AbortSignal.timeout(20000),
    redirect:'error',
    headers:{accept:'application/json'}
  });
  if (!response.ok) throw new Error('Published Preprod '+name+' returned HTTP '+response.status+'.');
  const bytes=new Uint8Array(await response.arrayBuffer());
  if (bytes.length>262144) throw new Error('Published Preprod '+name+' exceeds expected size.');
  return bytes;
}
export async function checkCardanoPreprodPublicGenesis() {
  const [configuration,shelleyGenesisBytes,conwayGenesisBytes]=await Promise.all([
    published('config.json'),published('shelley-genesis.json'),published('conway-genesis.json')
  ]);
  let nodeConfig;
  try { nodeConfig=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(configuration)); }
  catch { throw new Error('Official Preprod node config is not valid JSON.'); }
  return verifyCardanoPreprodGenesisTiming({nodeConfig,shelleyGenesisBytes,conwayGenesisBytes});
}
if (process.argv[1]?.endsWith('verify-cardano-preprod-public-genesis.js')) {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    process.stdout.write('Read-only official Cardano Preprod genesis hash and timing verification; no wallet or chain-state operations.\\n');
  } else {
    try {
      const report=await checkCardanoPreprodPublicGenesis();
      process.stdout.write(JSON.stringify(report,null,2)+'\\n');
    } catch (error) {
      process.stderr.write('Official Preprod genesis provenance check blocked: '+String(error?.message??'verification failed')+'. No signing or submission.\\n');
      process.exitCode=2;
    }
  }
}
