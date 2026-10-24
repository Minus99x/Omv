import test from 'node:test';
import assert from 'node:assert/strict';
import {defineNetwork,getNetwork,listNetworks} from '../src/chains/network-registry.js';
const base={id:'testnet:limited',chainId:'testnet',name:'Limited',
 environment:'testnet',nativeSymbol:'TX',rpcProtocol:'evm-json-rpc',
 implementationStage:'scaffold',chainIdDecimal:51,chainIdHex:'0x33',
 rpcUrls:['https://rpc.test.invalid'],explorerUrls:[],notes:['Offline test only']};
test('network registry identifiers cannot be coerced through objects',()=>{
 for(const field of ['id','chainId','name','environment','nativeSymbol','rpcProtocol','implementationStage'])
  for(const bad of [{toString(){return 'hello'}},true,[],''])
   assert.throws(()=>defineNetwork({...base,[field]:bad}),/required|stage/);
});
test('network endpoint collections must remain primitive arrays',()=>{
 for(const field of ['rpcUrls','explorerUrls','notes']){
  assert.throws(()=>defineNetwork({...base,[field]:'https://host'}),/must be an array/);
  assert.throws(()=>defineNetwork({...base,[field]:[{}]}),/primitive nonempty/);
 }
});
test('network metadata forbids insecure and duplicate service endpoints',()=>{
 for(const url of ['http://localhost','ws://example.invalid','javascript:evil','ftp://server'])
  assert.throws(()=>defineNetwork({...base,rpcUrls:[url]}),/secure HTTP/);
 assert.throws(()=>defineNetwork({...base,
   rpcUrls:['https://rpc.test.invalid','https://rpc.test.invalid']}),/duplicates/);
 assert.ok(defineNetwork({...base,rpcUrls:['wss://node.test.invalid']}).id);
});
test('EVM chain ID hex and decimal cannot conflict or be coercively represented',()=>{
 for(const props of [{chainIdDecimal:'51'},{chainIdHex:'0x034'},
  {chainIdDecimal:52},{chainIdHex:'0x33z'},{chainIdHex:'0X33'}])
  assert.throws(()=>defineNetwork({...base,...props}),/EVM registry/);
 assert.equal(defineNetwork(base).chainIdDecimal,51);
});
test('established Signet, Cardano and EVM network identities remain registered',()=>{
 assert.equal(getNetwork('bitcoin:signet').chainId,'bitcoin');
 assert.equal(getNetwork('xdc:apothem').chainIdDecimal,51);
 assert.ok(listNetworks({chainId:'cardano'}).some(n=>n.id==='cardano:preprod'));
});
