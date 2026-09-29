export function createCardanoRecoveryBlueprint({ threshold = 2, contactCount = 3, invalidBeforeSlot = null }) {
  if (!Number.isInteger(contactCount) || contactCount < 1 || contactCount > 16) throw new TypeError('contactCount must be 1-16.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contactCount) throw new TypeError('threshold must be reachable.');
  if (invalidBeforeSlot != null && (!Number.isInteger(invalidBeforeSlot) || invalidBeforeSlot < 0)) throw new TypeError('invalidBeforeSlot must be a non-negative slot.');
  return Object.freeze({
    chainId: 'cardano', networkRef: 'cardano:preprod', strategy: 'plutus-v3-aiken-state-utxo', threshold, contactCount, invalidBeforeSlot,
    requiredComponents: Object.freeze(['compiled Aiken Plutus V3 recovery validator', 'one-shot state-beacon mint/burn policy', 'CIP-57 blueprint', 'EUTXO selection and change safety', 'native asset bundle handling', 'finite POSIX validity interval', 'current-protocol-parameter fee/min-UTXO calculation', 'external collateral and fee inputs', 'parameterized-script address and transaction builders']),
    unresolved: Object.freeze(['Obtain a second independent machine-readable Preprod cost-model snapshot and require exact agreement before live construction.', 'Evaluate the zero-budget transaction candidates through one synchronized Preprod node/Ogmios acquired state and replace Aiken unit-test budgets with node-evaluated execution units.', 'Rerun signed-size, fee, minimum-ADA, collateral and complete phase-1 validation with accepted node budgets, then select a real seed UTxO and bind deployment evidence.'])
  });
}
