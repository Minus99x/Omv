import test from 'node:test';
import assert from 'node:assert/strict';
import { Keypair, TransactionBuilder } from '@stellar/stellar-sdk';
import {
  buildFeeBumpEnvelopeArtifact,
  buildHeartbeatEnvelopeArtifact,
  buildRecoveryEnvelopeArtifact,
  createFeeBumpSponsorPlan,
  createHeartbeatPlan,
  createRecoveryEnvelopePlan
} from '../src/chains/stellar/native-recovery.js';
import {
  createStellarTestnetExecutionInputManifest,
  verifyStellarTestnetExecutionInputManifest
} from '../src/chains/stellar/execution-input-manifest.js';

const KP = n => Keypair.fromRawEd25519Seed(new Uint8Array(32).fill(n));
const G = n => KP(n).publicKey();

function inputs() {
  const recoveryPlan = createRecoveryEnvelopePlan({
    vaultAccount:G(1), rescueDestination:G(2), currentSequence:'1000', inactivitySeconds:60,
    contacts:[G(3), G(4)], threshold:2, assets:['native', { code:'USDC', issuer:G(6) }],
    amounts:{ native:'10', [`USDC:${G(6)}`]:'20.5' }
  });
  const recoveryArtifact = buildRecoveryEnvelopeArtifact(recoveryPlan);
  const recovery = TransactionBuilder.fromXdr(recoveryArtifact.transactionXdr, recoveryPlan.networkPassphrase);
  recovery.sign(KP(3), KP(4));
  const signedRecoveryTransactionXdr = recovery.toXdr();
  const heartbeatPlan = createHeartbeatPlan({ vaultAccount:G(1), currentSequence:'1001' });
  const heartbeatArtifact = buildHeartbeatEnvelopeArtifact({ vaultAccount:G(1), currentSequence:'1001' });
  const heartbeat = TransactionBuilder.fromXdr(heartbeatArtifact.transactionXdr, heartbeatArtifact.networkPassphrase);
  heartbeat.sign(KP(1));
  const signedHeartbeatTransactionXdr = heartbeat.toXdr();
  const feeBumpPlan = createFeeBumpSponsorPlan({ feeAccount:G(7), innerEnvelopeHash:recoveryArtifact.transactionHashHex, maxFeeStroops:'1000' });
  const feeBumpArtifact = buildFeeBumpEnvelopeArtifact({ recoveryPlan, recoveryArtifact, signedRecoveryTransactionXdr, feeBumpPlan, baseFeeStroops:'200' });
  const feeBump = TransactionBuilder.fromXdr(feeBumpArtifact.feeBumpTransactionXdr, feeBumpArtifact.networkPassphrase);
  feeBump.sign(KP(7));
  return { recoveryPlan, recoveryArtifact, signedRecoveryTransactionXdr, heartbeatPlan, heartbeatArtifact, signedHeartbeatTransactionXdr, feeBumpPlan, feeBumpArtifact, signedFeeBumpTransactionXdr:feeBump.toXdr() };
}

test('Stellar execution manifest binds exact public accounts, sequences, assets, fee cap and signed envelopes', () => {
  const runtime = inputs();
  const manifest = createStellarTestnetExecutionInputManifest(runtime);
  assert.equal(manifest.schema, 'omegavault.stellar.testnet-execution-input-manifest.v1');
  assert.equal(manifest.sourceAccount, G(1));
  assert.equal(manifest.rescueDestination, G(2));
  assert.equal(manifest.expectedInitialSequence, '1001');
  assert.equal(manifest.expectedPostHeartbeatSequence, '1003');
  assert.deepEqual(manifest.operations.map(operation => operation.assetKey), ['native', `USDC:${G(6)}`]);
  assert.equal(manifest.envelopes.feeBump.maxFeeStroops, '1000');
  assert.match(manifest.envelopes.recovery.signedEnvelopeSha256, /^[a-f0-9]{64}$/);
  assert.equal(manifest.signingKeysAccepted, false);
  assert.equal(manifest.liveSubmissionAuthority, false);
  assert.equal(manifest.chainPromotionAuthority, false);
  assert.deepEqual(verifyStellarTestnetExecutionInputManifest({ manifest, inputs:runtime }), { ok:true, errors:[] });
});

test('manifest verification rejects cross-wired rescue, sequence and fee policy', () => {
  const runtime = inputs();
  const manifest = createStellarTestnetExecutionInputManifest(runtime);
  const rescue = inputs();
  rescue.recoveryPlan = { ...rescue.recoveryPlan, rescueDestination:G(8) };
  assert.equal(verifyStellarTestnetExecutionInputManifest({ manifest, inputs:rescue }).ok, false);
  const sequence = inputs();
  sequence.heartbeatPlan = { ...sequence.heartbeatPlan, transactionSequence:'1003' };
  assert.equal(verifyStellarTestnetExecutionInputManifest({ manifest, inputs:sequence }).ok, false);
  const fee = inputs();
  fee.feeBumpPlan = { ...fee.feeBumpPlan, maxFeeStroops:'599' };
  assert.equal(verifyStellarTestnetExecutionInputManifest({ manifest, inputs:fee }).ok, false);
});

test('manifest verification rejects any changed signed envelope even when the transaction hash is unchanged', () => {
  const runtime = inputs();
  const manifest = createStellarTestnetExecutionInputManifest(runtime);
  const changed = inputs();
  const heartbeat = TransactionBuilder.fromXdr(changed.heartbeatArtifact.transactionXdr, changed.heartbeatArtifact.networkPassphrase);
  heartbeat.sign(KP(1));
  heartbeat.sign(KP(1));
  changed.signedHeartbeatTransactionXdr = heartbeat.toXdr();
  const result = verifyStellarTestnetExecutionInputManifest({ manifest, inputs:changed });
  assert.equal(result.ok, false);
  assert.match(result.errors.join(' '), /heartbeat artifact failed execution-manifest preflight/);
});

test('manifest verification rejects tampering, undeclared fields and authority escalation', () => {
  const runtime = inputs();
  const manifest = createStellarTestnetExecutionInputManifest(runtime);
  assert.equal(verifyStellarTestnetExecutionInputManifest({ manifest:{ ...manifest, rescueDestination:G(8) }, inputs:runtime }).ok, false);
  assert.equal(verifyStellarTestnetExecutionInputManifest({ manifest:{ ...manifest, unexpected:true }, inputs:runtime }).ok, false);
  assert.equal(verifyStellarTestnetExecutionInputManifest({ manifest:{ ...manifest, liveSubmissionAuthority:true }, inputs:runtime }).ok, false);
});

test('manifest construction rejects duplicate assets and non-canonical signed-envelope encoding', () => {
  const runtime = inputs();
  runtime.recoveryPlan = { ...runtime.recoveryPlan, operations:[runtime.recoveryPlan.operations[0], runtime.recoveryPlan.operations[0]] };
  assert.throws(() => createStellarTestnetExecutionInputManifest(runtime), /duplicate-free recovery asset set|artifact failed/);
  const malformed = inputs();
  malformed.signedHeartbeatTransactionXdr = `${malformed.signedHeartbeatTransactionXdr}\n`;
  assert.throws(() => createStellarTestnetExecutionInputManifest(malformed), /canonical base64 XDR|artifact failed/);
});
