import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import { blake2b } from '@noble/hashes/blake2.js';

const HEX_28 = /^[0-9a-f]{56}$/i;
const HEX_32 = /^[0-9a-f]{64}$/i;

export const CARDANO_PREPROD_NETWORK_ID = 0;
export const CARDANO_PREPROD_NETWORK_MAGIC = 1;
export const CARDANO_PREPROD_SLOT_ANCHOR = 86400;
export const CARDANO_PREPROD_TIME_ANCHOR_MS = 1655769600000;
export const CARDANO_PREPROD_EVALUATION_VALIDITY_WINDOW_SLOTS = 1800;

export const CARDANO_APPLIED_FIXTURE = Object.freeze({
  purpose: 'offline-reproducibility-only',
  deployable: false,
  seedTxId: 'ab'.repeat(32),
  seedOutputIndex: 0,
  assetNameHex: '4f56',
  beaconPolicyId: '3c298bd60240d5d6d89811dc9fcffd9f37c6d60df8f74562cc01fcd6',
  beaconPolicyAddress: 'addr_test1wq7znz7kqfqdt4kcnqgae870lk0n03kkphu0w3tzesqle4sz25mla',
  recoveryValidatorHash: '2f59df4cdf1199ef68d705b6a30f6738cf31075d361692cb8a58c4b4',
  recoveryValidatorAddress: 'addr_test1wqh4nh6vmugenmmg6uzmdgc0vuuv7vg8t5mpdykt3fvvfdqp2ftmw'
});

const fixtureKeys = Object.freeze({
  owner: '11'.repeat(28),
  contact: '22'.repeat(28),
  contactB: '33'.repeat(28),
  rescue: '66'.repeat(28)
});

const FIXTURE_VALIDITY_START = Object.freeze({
  initialize: 100000060,
  heartbeat: 100000100,
  approve: 100000060,
  execute: 100000060
});

function bytes(value) {
  return Uint8Array.from(Buffer.from(value, 'hex'));
}

function hex(value) {
  return Buffer.from(value).toString('hex');
}

function assertHex(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value)) throw new TypeError(`${label} has invalid length or encoding.`);
  return value.toLowerCase();
}

function plutusBytes(value) {
  return Cardano.PlutusData.new_bytes(bytes(value));
}

function plutusInteger(value) {
  return Cardano.PlutusData.new_integer(Cardano.BigInt.from_str(String(value)));
}

function plutusList(items) {
  const list = Cardano.PlutusList.new();
  for (const item of items) list.add(item);
  return Cardano.PlutusData.new_list(list);
}

function plutusConstr(alternative, fields) {
  const list = Cardano.PlutusList.new();
  for (const field of fields) list.add(field);
  return Cardano.PlutusData.new_constr_plutus_data(
    Cardano.ConstrPlutusData.new(Cardano.BigNum.from_str(String(alternative)), list)
  );
}

function addressDatumFromKeyHash(keyHash) {
  const credential = plutusConstr(0, [plutusBytes(assertHex(keyHash, HEX_28, 'rescueKeyHash'))]);
  const noStakeCredential = plutusConstr(1, []);
  return plutusConstr(0, [credential, noStakeCredential]);
}

export function cardanoPreprodSlotToUnixTimeMs(slot) {
  if (!Number.isSafeInteger(slot) || slot < 0) throw new TypeError('slot must be a non-negative safe integer.');
  return CARDANO_PREPROD_TIME_ANCHOR_MS + ((slot - CARDANO_PREPROD_SLOT_ANCHOR) * 1000);
}

function fixtureTiming(action, evaluationSlot = null) {
  const fixedLowerSlot = FIXTURE_VALIDITY_START[action];
  if (!fixedLowerSlot) throw new TypeError('Unknown Cardano fixture action.');

  let lowerSlot = fixedLowerSlot;
  let upperSlot = fixedLowerSlot + 140;
  let liveTipSlot = null;

  if (evaluationSlot !== null && evaluationSlot !== undefined) {
    if (!Number.isSafeInteger(evaluationSlot) || evaluationSlot < 30) {
      throw new TypeError('evaluationSlot must be a safe Preprod slot at least 30.');
    }
    liveTipSlot = evaluationSlot;
    lowerSlot = evaluationSlot - 30;
    upperSlot = evaluationSlot + CARDANO_PREPROD_EVALUATION_VALIDITY_WINDOW_SLOTS;
  }

  const lowerTimeMs = cardanoPreprodSlotToUnixTimeMs(lowerSlot);
  return Object.freeze({
    liveTipSlot,
    lowerSlot,
    upperSlot,
    lowerTimeMs,
    priorHeartbeatMs: lowerTimeMs - 60000
  });
}

export function createCardanoVaultDatumData({
  ownerKeyHash,
  rescueKeyHash,
  contactKeyHashes,
  threshold,
  inactivityMs,
  lastHeartbeatMs,
  approvalKeyHashes = []
}) {
  const owner = assertHex(ownerKeyHash, HEX_28, 'ownerKeyHash');
  const contacts = contactKeyHashes.map((value, index) => assertHex(value, HEX_28, `contactKeyHashes[${index}]`));
  const approvals = approvalKeyHashes.map((value, index) => assertHex(value, HEX_28, `approvalKeyHashes[${index}]`));
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) throw new TypeError('threshold must be reachable.');
  if (!Number.isSafeInteger(inactivityMs) || inactivityMs < 1) throw new TypeError('inactivityMs must be positive.');
  if (!Number.isSafeInteger(lastHeartbeatMs) || lastHeartbeatMs < 0) throw new TypeError('lastHeartbeatMs must be non-negative.');
  if (new Set(contacts).size !== contacts.length || new Set(approvals).size !== approvals.length) throw new TypeError('contacts and approvals must be unique.');
  if (approvals.some(value => !contacts.includes(value))) throw new TypeError('approval is not a configured contact.');

  return plutusConstr(0, [
    plutusBytes(owner),
    addressDatumFromKeyHash(rescueKeyHash),
    plutusList(contacts.map(plutusBytes)),
    plutusInteger(threshold),
    plutusInteger(inactivityMs),
    plutusInteger(lastHeartbeatMs),
    plutusList(approvals.map(plutusBytes))
  ]);
}

export function deriveCardanoEnterpriseScriptAddress({ scriptHash, networkId = CARDANO_PREPROD_NETWORK_ID }) {
  const normalized = assertHex(scriptHash, HEX_28, 'scriptHash');
  if (!Number.isInteger(networkId) || networkId < 0 || networkId > 15) throw new TypeError('networkId must be 0-15.');
  const credential = Cardano.Credential.from_scripthash(Cardano.ScriptHash.from_hex(normalized));
  return Cardano.EnterpriseAddress.new(networkId, credential).to_address().to_bech32();
}

function enterpriseKeyAddress(keyHash) {
  const credential = Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex(assertHex(keyHash, HEX_28, 'keyHash')));
  return Cardano.EnterpriseAddress.new(CARDANO_PREPROD_NETWORK_ID, credential).to_address();
}

function transactionInput(txId, index) {
  return Cardano.TransactionInput.new(Cardano.TransactionHash.from_hex(assertHex(txId, HEX_32, 'txId')), index);
}

function valueWithBeacon(lovelace, includeBeacon) {
  const value = Cardano.Value.new(Cardano.BigNum.from_str(String(lovelace)));
  if (includeBeacon) {
    const assets = Cardano.Assets.new();
    assets.insert(Cardano.AssetName.new(bytes(CARDANO_APPLIED_FIXTURE.assetNameHex)), Cardano.BigNum.one());
    const multiasset = Cardano.MultiAsset.new();
    multiasset.insert(Cardano.ScriptHash.from_hex(CARDANO_APPLIED_FIXTURE.beaconPolicyId), assets);
    value.set_multiasset(multiasset);
  }
  return value;
}

function setBeaconMint(body, quantity) {
  const assets = Cardano.MintAssets.new();
  assets.insert(Cardano.AssetName.new(bytes(CARDANO_APPLIED_FIXTURE.assetNameHex)), Cardano.Int.from_str(String(quantity)));
  const mint = Cardano.Mint.new();
  mint.insert(Cardano.ScriptHash.from_hex(CARDANO_APPLIED_FIXTURE.beaconPolicyId), assets);
  body.set_mint(mint);
}

function vaultDatumForInput(action, evaluationSlot = null) {
  const timing = fixtureTiming(action, evaluationSlot);
  const approvals = action === 'execute'
    ? [fixtureKeys.contact, fixtureKeys.contactB]
    : action === 'heartbeat'
      ? [fixtureKeys.contact]
      : [];
  return createCardanoVaultDatumData({
    ownerKeyHash: fixtureKeys.owner,
    rescueKeyHash: fixtureKeys.rescue,
    contactKeyHashes: [fixtureKeys.contact, fixtureKeys.contactB],
    threshold: 2,
    inactivityMs: 60000,
    lastHeartbeatMs: timing.priorHeartbeatMs,
    approvalKeyHashes: approvals
  });
}

function ogmiosValue(lovelace, includeBeacon = false) {
  const quantity = Number(lovelace);
  if (!Number.isSafeInteger(quantity) || quantity < 0) throw new TypeError('Ogmios lovelace quantity must be a non-negative safe integer.');
  const value = {
    ada: Object.freeze({ lovelace: quantity })
  };
  if (includeBeacon) {
    value[CARDANO_APPLIED_FIXTURE.beaconPolicyId] = Object.freeze({
      [CARDANO_APPLIED_FIXTURE.assetNameHex]: 1
    });
  }
  return Object.freeze(value);
}

function ogmiosUtxo({ transactionId, index, address, lovelace, includeBeacon = false, datum = null }) {
  if (!Number.isSafeInteger(index) || index < 0) throw new TypeError('Ogmios UTxO index must be a non-negative safe integer.');
  const utxo = {
    transaction: Object.freeze({ id: assertHex(transactionId, HEX_32, 'transactionId') }),
    index,
    address,
    value: ogmiosValue(lovelace, includeBeacon)
  };
  if (datum != null) utxo.datum = datum.to_hex();
  return Object.freeze(utxo);
}

function normalizeFixtureFeeLovelace(value) {
  const text = String(value);
  if (!/^\d+$/.test(text) || BigInt(text) < 1n) throw new TypeError('feeLovelace must be positive.');
  const feeLovelace = BigInt(text);
  const feePayerInputLovelace = 3000000n + feeLovelace;
  if (feePayerInputLovelace > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new TypeError('feeLovelace exceeds the safe UTxO accounting range.');
  }
  return Object.freeze({
    feeLovelace: feeLovelace.toString(),
    feePayerInputLovelace: Number(feePayerInputLovelace)
  });
}

export function buildCardanoEvaluationAdditionalUtxoSet(action, {
  evaluationSlot = null,
  feeLovelace = '200000'
} = {}) {
  if (!['initialize', 'heartbeat', 'approve', 'execute'].includes(action)) throw new TypeError('action must be initialize, heartbeat, approve, or execute.');
  const fee = normalizeFixtureFeeLovelace(feeLovelace);
  const ownerAddress = enterpriseKeyAddress(fixtureKeys.owner).to_bech32();
  const entries = [];

  if (action === 'initialize') {
    entries.push(ogmiosUtxo({
      transactionId: CARDANO_APPLIED_FIXTURE.seedTxId,
      index: CARDANO_APPLIED_FIXTURE.seedOutputIndex,
      address: ownerAddress,
      lovelace: 10000000
    }));
  } else {
    entries.push(ogmiosUtxo({
      transactionId: 'cd'.repeat(32),
      index: 0,
      address: CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress,
      lovelace: 10000000,
      includeBeacon: true,
      datum: vaultDatumForInput(action, evaluationSlot)
    }));
  }

  entries.push(ogmiosUtxo({
    transactionId: 'ef'.repeat(32),
    index: 1,
    address: ownerAddress,
    lovelace: fee.feePayerInputLovelace
  }));
  entries.push(ogmiosUtxo({
    transactionId: '12'.repeat(32),
    index: 0,
    address: ownerAddress,
    lovelace: 5000000
  }));

  return Object.freeze(entries);
}

export function buildCardanoTransactionBodyFixture(action, {
  feeLovelace = '200000',
  scriptDataHashHex = '99'.repeat(32),
  evaluationContext = false,
  evaluationSlot = null
} = {}) {
  if (!['initialize', 'heartbeat', 'approve', 'execute'].includes(action)) throw new TypeError('action must be initialize, heartbeat, approve, or execute.');
  if (!evaluationContext && evaluationSlot !== null && evaluationSlot !== undefined) {
    throw new TypeError('evaluationSlot is only valid for a public Preprod evaluation context.');
  }
  const fee = normalizeFixtureFeeLovelace(feeLovelace);
  const timing = evaluationContext ? fixtureTiming(action, evaluationSlot) : null;

  const inputs = Cardano.TransactionInputs.new();
  inputs.add(transactionInput(action === 'initialize' ? CARDANO_APPLIED_FIXTURE.seedTxId : 'cd'.repeat(32), 0));
  inputs.add(transactionInput('ef'.repeat(32), 1));

  const outputs = Cardano.TransactionOutputs.new();
  const scriptAddress = Cardano.Address.from_bech32(CARDANO_APPLIED_FIXTURE.recoveryValidatorAddress);
  const rescueAddress = enterpriseKeyAddress(fixtureKeys.rescue);
  const feePayerAddress = enterpriseKeyAddress(fixtureKeys.owner);
  if (action === 'execute') {
    outputs.add(Cardano.TransactionOutput.new(rescueAddress, valueWithBeacon('10000000', false)));
  } else {
    const approvals = action === 'approve' ? [fixtureKeys.contact] : [];
    const heartbeat = evaluationContext
      ? (action === 'heartbeat' ? timing.lowerTimeMs : timing.priorHeartbeatMs)
      : (action === 'heartbeat' ? 1100000 : 1000000);
    const output = Cardano.TransactionOutput.new(scriptAddress, valueWithBeacon('10000000', true));
    output.set_plutus_data(createCardanoVaultDatumData({
      ownerKeyHash: fixtureKeys.owner,
      rescueKeyHash: fixtureKeys.rescue,
      contactKeyHashes: [fixtureKeys.contact, fixtureKeys.contactB],
      threshold: 2,
      inactivityMs: 60000,
      lastHeartbeatMs: heartbeat,
      approvalKeyHashes: approvals
    }));
    outputs.add(output);
  }
  outputs.add(Cardano.TransactionOutput.new(feePayerAddress, valueWithBeacon('3000000', false)));

  if (!/^[0-9a-f]{64}$/i.test(scriptDataHashHex)) throw new TypeError('scriptDataHashHex must be 32 bytes.');
  const body = Cardano.TransactionBody.new_tx_body(inputs, outputs, Cardano.BigNum.from_str(fee.feeLovelace));
  body.set_network_id(Cardano.NetworkId.testnet());
  body.set_validity_start_interval_bignum(Cardano.BigNum.from_str(String(evaluationContext ? timing.lowerSlot : (action === 'heartbeat' ? 1100 : 1060))));
  body.set_ttl(Cardano.BigNum.from_str(String(evaluationContext ? timing.upperSlot : 1200)));
  const collateral = Cardano.TransactionInputs.new();
  collateral.add(transactionInput('12'.repeat(32), 0));
  body.set_collateral(collateral);
  body.set_total_collateral(Cardano.BigNum.from_str('5000000'));
  body.set_script_data_hash(Cardano.ScriptDataHash.from_hex(scriptDataHashHex));

  if (action === 'initialize') setBeaconMint(body, 1);
  if (action === 'execute') setBeaconMint(body, -1);
  if (action !== 'execute') {
    const signers = Cardano.Ed25519KeyHashes.new();
    signers.add(Cardano.Ed25519KeyHash.from_hex(action === 'approve' ? fixtureKeys.contact : fixtureKeys.owner));
    body.set_required_signers(signers);
  }

  const cbor = body.to_bytes();
  const decoded = Cardano.TransactionBody.from_bytes(cbor);
  const roundTrip = decoded.to_bytes();
  if (hex(cbor) !== hex(roundTrip)) throw new Error('Cardano transaction-body CBOR did not round-trip canonically.');

  return Object.freeze({
    action,
    cborHex: hex(cbor),
    bodyHashHex: hex(blake2b(cbor, { dkLen: 32 })),
    bytes: cbor.length,
    roundTripExact: true,
    networkId: decoded.network_id().kind(),
    inputCount: decoded.inputs().len(),
    outputCount: decoded.outputs().len(),
    hasCollateral: decoded.collateral().len() === 1,
    mintQuantity: action === 'initialize' ? 1 : action === 'execute' ? -1 : 0,
    validity: evaluationContext ? timing : Object.freeze({
      lowerSlot: action === 'heartbeat' ? 1100 : 1060,
      upperSlot: 1200,
      lowerTimeMs: null,
      priorHeartbeatMs: null
    }),
    evaluationContext,
    requiresLiveProtocolParameters: true,
    scriptDataHashIsFixtureOnly: true
  });
}
