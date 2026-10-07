# Bitcoin Finalizer and Signet Evidence — post-0.6.48 development

## Scope

This development block strengthens OmegaVault's Bitcoin recovery evidence without pretending that offline verification is a Signet execution proof or that standard Bitcoin script provides an immutable rescue covenant.

## Offline finalizer evidence

`src/chains/bitcoin/finalizer-evidence.js` validates a supplied PSBTv2 recovery package and records a digest-bound evidence artifact only when all of these conditions hold:

- network/policy is the configured Bitcoin Signet recovery descriptor;
- PSBTv2 maps are canonical and inputs/outputs are frozen;
- every input is bound to the expected descriptor witness script and P2WSH output;
- every input satisfies the configured CSV recovery delay;
- partial signatures come only from configured contacts;
- the configured recovery threshold is cryptographically satisfied;
- exactly one configured rescue output is present in strict mode;
- input/output accounting leaves a positive miner fee.

The artifact explicitly records:

- `destinationCheckedByFinalizer: true`;
- `immutableRescueOnChain: false`;
- `broadcastAuthorized: false`;
- `signetExecutionProven: false`.

This is intentionally not a transaction broadcaster or wallet.

## Deterministic final transaction extraction

`src/chains/bitcoin/transaction-finalizer.js` now converts the frozen, threshold-signed PSBTv2 into the exact SegWit transaction bytes required by BIP 370's extractor role. It:

- rebuilds and compares the canonical recovery descriptor before witness construction;
- orders valid contact signatures by the public-key order committed in the witness script;
- constructs the CHECKMULTISIG dummy element, delayed-recovery branch selector and witness script;
- binds raw/stripped bytes, txid, wtxid, weight and virtual size;
- emits `omegavault.bitcoin.final-transaction-evidence.v1` without broadcasting or handling private keys.

The deterministic fixture freezes txid `0b01a21c7889debcbfb405d4bca27c1c3c3eb11979bbb516567ae0c99f517961`, wtxid `48dc875636a696ba86926bc62a5fd27ed28c94902f9784f9f0adf0a4b2eb836b`, weight 593 and virtual size 149 for regression detection. Those values are offline test evidence, not Signet observations.

## Read-only Signet observation evidence

`src/chains/bitcoin/signet-evidence.js` adds a read-only observation layer. A caller-supplied transaction ID can be checked through an injected driver that exposes only transaction and UTXO reads.

The evidence binds:

- Signet network identity;
- finalizer-evidence digest;
- PSBT digest;
- descriptor policy digest;
- confirmation depth;
- block hash and height;
- exact rescue output script and amount;
- rescue outpoint identity and current unspent status.

The runner cannot construct, sign, finalize, or broadcast Bitcoin transactions.

## Read-only Bitcoin Core cross-check

`src/chains/bitcoin/core-cross-check.js` provides a separate injected-driver gate for the exact transaction produced by the deterministic extractor. It requires a pinned Bitcoin Core version on Signet and binds:

- the SHA-256 of the exact network-serialized transaction;
- Core's decoded txid, wtxid, size, weight, virtual size, version and locktime;
- every input outpoint, sequence, empty native SegWit `scriptSig` and complete witness stack;
- every output index, exact satoshi amount and script;
- exactly one non-broadcast `testmempoolaccept` result for the same txid/wtxid.

Offline fixtures keep `bitcoinCoreCrossCheckProven: false`. The read-only runner can set it only from a driver identified as Bitcoin Core RPC and only when the pinned node accepts the exact transaction. This flag is still not a Signet inclusion/finality proof. The runner exposes no signing or broadcast capability, and the evidence keeps `signetExecutionProven`, `broadcastPerformed`, `broadcastAuthorized` and `chainPromotionAuthority` false.

## Adversarial coverage

Focused tests reject:

- incomplete contact threshold;
- unexpected signer keys;
- CSV sequence below policy;
- wrong rescue destination;
- extra outputs in strict rescue mode;
- evidence tampering;
- insufficient Signet confirmations;
- rescue outpoint substitution;
- rescue amount or script drift;
- driver transaction substitution.
- non-canonical descriptor/contact ordering;
- descriptor, CSV and rescue-output substitution during final extraction;
- final-transaction evidence tampering.
- wrong Signet identity or unpinned Bitcoin Core version;
- decoded txid/wtxid, witness, output amount/script or size substitution;
- mempool-result transaction substitution and rejected-result ambiguity;
- Bitcoin Core cross-check evidence tampering.

## Remaining Bitcoin gates

Bitcoin remains `reduced-semantics`.

The remaining evidence/semantic boundaries are:

1. actual public Signet execution/observation;
2. execution of the read-only decode/acceptance cross-check against an actual pinned Bitcoin Core runtime rather than the offline driver fixture;
3. production fee/finality policy evidence;
4. the known immutable-rescue limitation: standard key + CSV script does not cryptographically force all future threshold spends to one rescue destination.

The application-side finalizer can require contacts to sign a transaction containing the configured rescue output, but this is not equivalent to an on-chain covenant.

## Authority boundary

No code in this development block authorizes Bitcoin mainnet use, live-value spending, wallet signing, transaction broadcasting, deployment authority, or chain promotion.
