import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeCompactSize } from '../src/chains/bitcoin/psbt-v2.js';

test('CompactSize rejects coercible containers and boolean values',()=>{
  for (const value of [true,false,[],[253],new Number(253),new String('253'),Object(253n),null,undefined]) {
    assert.throws(()=>encodeCompactSize(value),/CompactSize value must be/);
  }
});

test('CompactSize rejects objects without invoking conversion hooks',()=>{
  let calls=0;
  for (const value of [
    {[Symbol.toPrimitive](){calls++;return 253n;}},
    {valueOf(){calls++;return 253;}},
    {toString(){calls++;return '253';}}
  ]) assert.throws(()=>encodeCompactSize(value),/CompactSize value must be/);
  assert.equal(calls,0);
});

test('CompactSize rejects unsafe or noninteger numeric inputs before rounding can be serialized',()=>{
  for (const value of [Number.MAX_SAFE_INTEGER+1,Number.MAX_SAFE_INTEGER+2,Number(0xffffffffffffffffn),1.5,NaN,Infinity,-Infinity]) {
    assert.throws(()=>encodeCompactSize(value),/CompactSize value must be/);
  }
});

test('CompactSize rejects ambiguous or nondecimal string inputs',()=>{
  for (const value of ['', ' ', ' 253', '253 ', '+253', '0xfd', '0b11111101', '0o375', '2.53e2', '253.0']) {
    assert.throws(()=>encodeCompactSize(value),/CompactSize value must be/);
  }
});

test('CompactSize preserves exact minimal bytes at every width boundary',()=>{
  const vectors=[
    [0n,'00'],[252n,'fc'],[253n,'fdfd00'],[65535n,'fdffff'],
    [65536n,'fe00000100'],[4294967295n,'feffffffff'],
    [4294967296n,'ff0000000001000000'],
    [9007199254740991n,'ffffffffffffff1f00'],
    [9007199254740993n,'ff0100000000002000'],
    [18446744073709551615n,'ffffffffffffffffff']
  ];
  for (const [value,hex] of vectors) {
    assert.equal(encodeCompactSize(value).toString('hex'),hex);
    assert.equal(encodeCompactSize(value.toString()).toString('hex'),hex);
    if (value<=BigInt(Number.MAX_SAFE_INTEGER))
      assert.equal(encodeCompactSize(Number(value)).toString('hex'),hex);
  }
});

test('CompactSize refuses values outside uint64 without wrapping',()=>{
  for (const value of [-1n,-1,18446744073709551616n,'18446744073709551616']) {
    assert.throws(()=>encodeCompactSize(value),/outside uint64/);
  }
});
