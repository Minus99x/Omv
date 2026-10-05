export const CORE_INVARIANTS = Object.freeze([
  Object.freeze({ id: 'OV-I01', key: 'owner-control', statement: 'Owner retains control of assets and owner-authorized lifecycle decisions.' }),
  Object.freeze({ id: 'OV-I02', key: 'non-custodial', statement: 'OmegaVault does not obtain seed phrases, private keys, or general signing authority.' }),
  Object.freeze({ id: 'OV-I03', key: 'native-enforcement', statement: 'OmegaVault facilitates configuration while the chain-native mechanism enforces recovery conditions.' }),
  Object.freeze({ id: 'OV-I04', key: 'predetermined-plan-b', statement: 'Trusted contacts approve the owner\'s predetermined Plan B rather than authoring a new destination.' }),
  Object.freeze({ id: 'OV-I05', key: 'contact-non-beneficiary', statement: 'Trusted contacts are approvers and cannot redirect rescue funds.' }),
  Object.freeze({ id: 'OV-I06', key: 'authority-separation', statement: 'Trigger, approval, destination, and execution/finality authorities remain distinct.' }),
  Object.freeze({ id: 'OV-I07', key: 'multi-credential-resistance', statement: 'One compromised or repeated credential cannot satisfy a larger required quorum.' }),
  Object.freeze({ id: 'OV-I08', key: 'fail-closed', statement: 'Unknown, missing, stale, contradictory, or insufficient evidence defaults to no movement and no support promotion.' }),
  Object.freeze({ id: 'OV-I09', key: 'owner-lifecycle-authority', statement: 'Updates, migration, disablement, and exit remain owner-authorized.' }),
  Object.freeze({ id: 'OV-I10', key: 'company-independence', statement: 'Configured protection must not depend on OmegaVault Fintech Solutions continuing to operate.' }),
  Object.freeze({ id: 'OV-I11', key: 'cross-chain-equivalence', statement: 'Chains may use different native mechanisms but must preserve the same intent and equivalent protected outcome.' }),
  Object.freeze({ id: 'OV-I12', key: 'recovery-readiness', statement: 'Readiness covers owner status, quorum viability, trusted contacts, rescue configuration, and compatibility/migration status.' }),
  Object.freeze({ id: 'OV-I13', key: 'support-claim-gate', statement: 'A chain is not OmegaVault supported until native implementation invariants have public-testnet evidence.' })
]);

export const CORE_INVARIANT_IDS = Object.freeze(CORE_INVARIANTS.map(item => item.id));

const BY_ID = new Map(CORE_INVARIANTS.map(item => [item.id, item]));

export function getCoreInvariant(id) {
  return BY_ID.get(id) ?? null;
}
