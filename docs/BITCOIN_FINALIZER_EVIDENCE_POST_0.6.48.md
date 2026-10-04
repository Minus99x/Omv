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

## Remaining Bitcoin gates

Bitcoin remains `reduced-semantics`.

The remaining evidence/semantic boundaries are:

1. actual public Signet execution/observation;
2. a Bitcoin Core extraction/finalizer cross-check for the final signed transaction path;
3. production fee/finality policy evidence;
4. the known immutable-rescue limitation: standard key + CSV script does not cryptographically force all future threshold spends to one rescue destination.

The application-side finalizer can require contacts to sign a transaction containing the configured rescue output, but this is not equivalent to an on-chain covenant.

## Authority boundary

No code in this development block authorizes Bitcoin mainnet use, live-value spending, wallet signing, transaction broadcasting, deployment authority, or chain promotion.
