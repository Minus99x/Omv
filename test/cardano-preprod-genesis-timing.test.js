import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyCardanoPreprodGenesisTiming,
  PREPROD_SHELLEY_GENESIS_HASH,
  PREPROD_CONWAY_GENESIS_HASH
} from '../src/chains/cardano/preprod-genesis-timing.js';

const utf8=(value)=>new TextEncoder().encode(value);
function config(){
  return {
    Protocol:'Cardano',
    RequiresNetworkMagic:'RequiresMagic',
    ShelleyGenesisHash:PREPROD_SHELLEY_GENESIS_HASH,
    ConwayGenesisHash:PREPROD_CONWAY_GENESIS_HASH
  };
}
const fixture=()=>({
  nodeConfig:config(),
  shelleyGenesisBytes:utf8('{"networkId":"Testnet","networkMagic":1,"systemStart":"2022-06-01T00:00:00Z","epochLength":432000,"slotLength":1}'),
  conwayGenesisBytes:utf8('{"poolVotingThresholds":{},"dRepVotingThresholds":{}}')
});

test('official Preprod pins match published node configuration hashes',()=>{
  assert.equal(PREPROD_SHELLEY_GENESIS_HASH,'162d29c4e1cf6b8a84f2d692e67a3ac6bc7851bc3e6e4afe64d15778bed8bd86');
  assert.equal(PREPROD_CONWAY_GENESIS_HASH,'0eb6adaec3fcb1fe286c1b4ae0da2a117eafc3add51e17577d36dd39eddfc3db');
});
test('rejects raw JSON with believable timing but wrong authenticated genesis bytes',()=>{
  assert.throws(()=>verifyCardanoPreprodGenesisTiming(fixture()),/Raw Shelley genesis Blake2b-256 disagrees/);
});
test('rejects node config attempting to substitute a different network genesis',()=>{
  const x=fixture();
  x.nodeConfig.ShelleyGenesisHash='aa'.repeat(32);
  assert.throws(()=>verifyCardanoPreprodGenesisTiming(x),/does not match independently pinned Preprod genesis hashes/);
});
test('rejects a conflicting Conway genesis pin despite correct Shelley pin',()=>{
  const x=fixture();
  x.nodeConfig.ConwayGenesisHash='bb'.repeat(32);
  assert.throws(()=>verifyCardanoPreprodGenesisTiming(x),/does not match independently pinned Preprod genesis hashes/);
});
test('does not hash a parsed or stringified JSON object in place of original genesis bytes',()=>{
  const x=fixture();
  x.shelleyGenesisBytes={systemStart:'2022-06-01T00:00:00Z'};
  assert.throws(()=>verifyCardanoPreprodGenesisTiming(x),/original raw genesis bytes/);
});
test('empty or unbounded genesis input fails closed',()=>{
  const x=fixture();
  x.conwayGenesisBytes=new Uint8Array(0);
  assert.throws(()=>verifyCardanoPreprodGenesisTiming(x),/original raw genesis bytes/);
  x.conwayGenesisBytes=new Uint8Array(262145);
  assert.throws(()=>verifyCardanoPreprodGenesisTiming(x),/original raw genesis bytes/);
});
