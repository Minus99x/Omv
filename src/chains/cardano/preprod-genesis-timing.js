// Public Cardano Preprod genesis provenance inspection. Never signs, submits,
// contacts a wallet, or treats genesis configuration as current ledger evidence.
import { blake2b } from '@noble/hashes/blake2.js';
import { hashCardanoEvidence } from './evidence-binding.js';

// Pinned from Cardano Operations Book Preprod node configuration.
// https://book.world.dev.cardano.org/environments/preprod/config.json
export const PREPROD_SHELLEY_GENESIS_HASH = '162d29c4e1cf6b8a84f2d692e67a3ac6bc7851bc3e6e4afe64d15778bed8bd86';
export const PREPROD_CONWAY_GENESIS_HASH = '0eb6adaec3fcb1fe286c1b4ae0da2a117eafc3add51e17577d36dd39eddfc3db';

const MAX_GENESIS_BYTES=262144;
const HASH=/^[0-9a-f]{64}$/;
function exactBytes(value,label) {
  if (!(value instanceof Uint8Array) || value.byteLength===0 || value.byteLength>MAX_GENESIS_BYTES) {
    throw new TypeError(label+' must contain the bounded original raw genesis bytes.');
  }
  return value;
}
function blake2b256(bytes) {
  return Buffer.from(blake2b(bytes,{dkLen:32})).toString('hex');
}
function decodedJson(bytes,label) {
  try {
    const doc=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
    if (!doc || typeof doc!=='object' || Array.isArray(doc)) throw new TypeError('object required');
    return doc;
  } catch {
    throw new TypeError(label+' is not valid UTF-8 JSON object content.');
  }
}
function positiveInt(value,label) {
  if (!Number.isSafeInteger(value)||value<=0) throw new TypeError(label+' must be a positive safe integer.');
  return value;
}

/**
 * Accept only byte-exact, hash-pinned official Preprod genesis artifacts.
 *
 * This is OFFLINE proof of configured genesis bytes and timing; unlike an
 * authenticated node-tip check, it does NOT prove the current ledger era,
 * current protocol parameters, current UTxOs, or independent phase one.
 */
export function verifyCardanoPreprodGenesisTiming({
  nodeConfig, shelleyGenesisBytes, conwayGenesisBytes
}) {
  if (!nodeConfig || typeof nodeConfig!=='object' || Array.isArray(nodeConfig)) {
    throw new TypeError('Node configuration must be a parsed object.');
  }
  const shelley=exactBytes(shelleyGenesisBytes,'Shelley genesis');
  const conway=exactBytes(conwayGenesisBytes,'Conway genesis');
  const expectedShelley=String(nodeConfig.ShelleyGenesisHash??'').toLowerCase();
  const expectedConway=String(nodeConfig.ConwayGenesisHash??'').toLowerCase();
  if (!HASH.test(expectedShelley)||expectedShelley!==PREPROD_SHELLEY_GENESIS_HASH ||
      !HASH.test(expectedConway)||expectedConway!==PREPROD_CONWAY_GENESIS_HASH) {
    throw new Error('Node configuration does not match independently pinned Preprod genesis hashes.');
  }
  const actualShelley=blake2b256(shelley);
  const actualConway=blake2b256(conway);
  if (actualShelley!==expectedShelley) throw new Error('Raw Shelley genesis Blake2b-256 disagrees with pinned Preprod node configuration.');
  if (actualConway!==expectedConway) throw new Error('Raw Conway genesis Blake2b-256 disagrees with pinned Preprod node configuration.');

  const shelleyDoc=decodedJson(shelley,'Shelley genesis');
  const conwayDoc=decodedJson(conway,'Conway genesis');
  if (shelleyDoc.networkId!=='Testnet'||shelleyDoc.networkMagic!==1 ||
      nodeConfig.Protocol!=='Cardano'||nodeConfig.RequiresNetworkMagic!=='RequiresMagic') {
    throw new Error('Genesis or node configuration does not identify Cardano Preprod testnet.');
  }
  if (!conwayDoc.poolVotingThresholds || !conwayDoc.dRepVotingThresholds) {
    throw new Error('Conway genesis lacks its required initial governance configuration.');
  }
  const systemStart=shelleyDoc.systemStart;
  const epochLength=positiveInt(shelleyDoc.epochLength,'Shelley epochLength');
  const slotLength=positiveInt(shelleyDoc.slotLength,'Shelley slotLength');
  // These immutable values identify the published Preprod genesis, not a
  // substitute for current node timing or a live Conway ledger report.
  if (systemStart!=='2022-06-01T00:00:00Z'||epochLength!==432000||slotLength!==1) {
    throw new Error('Pinned Preprod genesis has unexpected system start or era timing.');
  }
  const core=Object.freeze({
    schema:'omegavault.cardano.preprod-public-genesis-timing.v1',
    network:'preprod',
    source:'Cardano Operations Book published node and genesis configuration',
    genesis:Object.freeze({
      shelleyBlake2b256:actualShelley,
      conwayBlake2b256:actualConway,
      nodeConfigMatchesPinnedGenesisHashes:true,
      rawGenesisBytesVerified:true
    }),
    timing:Object.freeze({systemStart,epochLength,slotLength}),
    authenticPublishedGenesisProvenanceChecked:true,
    authenticatedLiveLedgerTipChecked:false,
    liveEraTimingIndependentlyCorroborated:false,
    currentProtocolParametersEstablished:false,
    completeConwayParametersEstablished:false,
    completePhaseOneValidated:false,
    walletSigningAuthorized:false,
    transactionSubmissionAuthorized:false,
    transactionSubmissionPerformed:false,
    nextGate:'Independently reconcile verified genesis timing against the fresh authenticated ledger and independently complete all Conway protocol parameters before phase-one validation.',
    authorityBoundary:'Published genesis integrity and timing only. No proof of current network state, signing, transaction submission or production support.'
  });
  return Object.freeze({...core,reportSha256:hashCardanoEvidence(core)});
}
