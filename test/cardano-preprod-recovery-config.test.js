import test from 'node:test';
import assert from 'node:assert/strict';
import * as Cardano from '@emurgo/cardano-serialization-lib-nodejs';
import {
  cardanoPreprodPaymentKeyHashFromAddress,
  createCardanoPreprodRecoveryConfiguration,
  verifyCardanoPreprodRecoveryConfiguration
} from '../src/chains/cardano/preprod-recovery-config.js';
import { CARDANO_PREPROD_NETWORK_ID } from '../src/chains/cardano/transaction-body.js';

function enterpriseAddress(byte) {
  const hash = Cardano.Ed25519KeyHash.from_hex(byte.repeat(28));
  return Cardano.EnterpriseAddress
    .new(CARDANO_PREPROD_NETWORK_ID, Cardano.Credential.from_keyhash(hash))
    .to_address()
    .to_bech32();
}

test('Cardano Preprod recovery configuration derives immutable rescue/contact key hashes from addresses', () => {
  const rescueAddress = enterpriseAddress('66');
  const contactAddresses = [enterpriseAddress('22'), enterpriseAddress('33')];
  const configuration = createCardanoPreprodRecoveryConfiguration({
    rescueAddress,
    contactAddresses,
    threshold: 2,
    inactivityMs: 60000,
    stateLovelace: '10000000'
  });

  assert.equal(configuration.network, 'preprod');
  assert.equal(configuration.rescueKeyHash, '66'.repeat(28));
  assert.deepEqual(configuration.contactKeyHashes, ['22'.repeat(28), '33'.repeat(28)]);
  assert.equal(configuration.contactsAreApproversOnly, true);
  assert.equal(configuration.contactsCannotRedirectDestination, true);
  assert.equal(configuration.destinationSeparatedFromApprovers, true);
  assert.equal(configuration.walletSigningAuthorized, false);
  assert.equal(configuration.transactionSubmissionAuthorized, false);
  assert.match(configuration.configurationSha256, /^[0-9a-f]{64}$/);

  const verified = verifyCardanoPreprodRecoveryConfiguration(configuration);
  assert.equal(verified.valid, true, verified.errors.join('; '));
});

test('Cardano Preprod recovery configuration rejects unreachable threshold, duplicate contacts and rescue/contact overlap', () => {
  const rescue = enterpriseAddress('66');
  const contact = enterpriseAddress('22');

  assert.throws(
    () => createCardanoPreprodRecoveryConfiguration({
      rescueAddress: rescue,
      contactAddresses: [contact],
      threshold: 2,
      inactivityMs: 60000
    }),
    /reachable/
  );

  assert.throws(
    () => createCardanoPreprodRecoveryConfiguration({
      rescueAddress: rescue,
      contactAddresses: [contact, contact],
      threshold: 1,
      inactivityMs: 60000
    }),
    /unique/
  );

  assert.throws(
    () => createCardanoPreprodRecoveryConfiguration({
      rescueAddress: rescue,
      contactAddresses: [rescue],
      threshold: 1,
      inactivityMs: 60000
    }),
    /cannot also be a trusted-contact/
  );
});

test('Cardano Preprod recovery configuration rejects script credentials and wrong-network addresses', () => {
  const scriptAddress = Cardano.EnterpriseAddress
    .new(CARDANO_PREPROD_NETWORK_ID, Cardano.Credential.from_scripthash(Cardano.ScriptHash.from_hex('ab'.repeat(28))))
    .to_address()
    .to_bech32();
  assert.throws(() => cardanoPreprodPaymentKeyHashFromAddress(scriptAddress), /payment verification key/);

  const mainnetAddress = Cardano.EnterpriseAddress
    .new(1, Cardano.Credential.from_keyhash(Cardano.Ed25519KeyHash.from_hex('11'.repeat(28))))
    .to_address()
    .to_bech32();
  assert.throws(() => cardanoPreprodPaymentKeyHashFromAddress(mainnetAddress), /network id 0/);
});

test('Cardano Preprod recovery configuration verifier rejects authority or digest tampering', () => {
  const configuration = createCardanoPreprodRecoveryConfiguration({
    rescueAddress: enterpriseAddress('66'),
    contactAddresses: [enterpriseAddress('22'), enterpriseAddress('33')],
    threshold: 2,
    inactivityMs: 60000
  });
  const tamperedAuthority = structuredClone(configuration);
  tamperedAuthority.transactionSubmissionAuthorized = true;
  assert.equal(verifyCardanoPreprodRecoveryConfiguration(tamperedAuthority).valid, false);

  const tamperedDigest = structuredClone(configuration);
  tamperedDigest.threshold = 1;
  assert.equal(verifyCardanoPreprodRecoveryConfiguration(tamperedDigest).valid, false);
});
