import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeOperationsBitmap, decodeOperationsBitmap, validatePermissionConfiguration, createThresholdPermission, createMultisignCoordinator, createDynamicFeeQueryPlan } from '../src/chains/tron/permissions.js';

const T = c => 'T' + c.repeat(33);

test('TRON operation bitmap round-trips contract type ids including permission update', () => {
  const bitmap = encodeOperationsBitmap([1, 31, 46]);
  assert.equal(bitmap.length, 64);
  assert.deepEqual(decodeOperationsBitmap(bitmap), [1,31,46]);
});

test('TRON permission validator rejects unreachable threshold and excessive keys', () => {
  const active = { type: 2, permission_name: 'x', threshold: 3, parent_id: 0, operations: encodeOperationsBitmap([1]), keys: [{ address: T('A'), weight: 1 }, { address: T('B'), weight: 1 }] };
  const config = validatePermissionConfiguration({ ownerPermission: { type: 0, threshold: 1, keys: [{ address: T('C'), weight: 1 }] }, activePermissions: [active] });
  assert.equal(config.ok, false);
  assert.ok(config.errors.some(x => /unreachable/i.test(x)));
});

test('TRON recovery permission restricts allowed operation types and coordinator rejects unknown signers', () => {
  const permission = createThresholdPermission({ permissionName: 'OmegaVault Recovery', contacts: [T('A'),T('B'),T('C')], threshold: 2, allowedOperationIds: [1,31] });
  assert.deepEqual(decodeOperationsBitmap(permission.operations), [1,31]);
  const partial = createMultisignCoordinator({ permission, transactionId: 'tx1', existingSigners: [T('A')] });
  assert.equal(partial.ready, false);
  assert.equal(partial.remainingWeight, 1);
  assert.throws(() => createMultisignCoordinator({ permission, transactionId: 'tx1', existingSigners: [T('D')] }), /invalidate/i);
});

test('TRON fee plan requires dynamic chain-parameter queries', () => {
  const plan = createDynamicFeeQueryPlan();
  assert.equal(plan.hardcodeFees, false);
  assert.ok(plan.requiredKeys.includes('getMultiSignFee'));
});
