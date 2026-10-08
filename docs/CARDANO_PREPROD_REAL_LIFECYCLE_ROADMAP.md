# Cardano Preprod Real Lifecycle Engineering Roadmap

Branch: `dev/0.6.60-reconcile-overnight-bitcoin`

Status: next remote engineering block after the first real initialize capture/signing boundary.

## Objective

Extend the real-input Cardano Preprod proof from **initialize** through the actual lifecycle:

`initialize -> heartbeat -> approve -> execute -> immutable rescue`

without weakening OmegaVault's authority boundaries.

No item in this roadmap authorizes wallet signing, transaction submission, value movement, support promotion, or a public-network recovery claim.

## Block A — Post-initialize observation

Remote engineering:

- define a digest-bound observation model for the submitted initialize transaction;
- bind the observed transaction id/body hash to the exact wallet-verified signed bytes;
- verify the expected recovery-vault output address;
- verify the beacon policy id/asset name and quantity;
- verify the exact protected-state lovelace amount;
- verify the inline datum reproduces the configured owner, rescue, contacts, threshold, inactivity interval and initial heartbeat state;
- reject extra/missing beacon-bearing state outputs;
- keep inclusion and finality distinct.

Workstation/network later:

- query the actual Preprod transaction/state UTxO after explicitly authorized submission;
- capture provider evidence;
- prove inclusion/finality under a separately defined Cardano finality policy.

## Block B — Real heartbeat

Remote engineering:

- consume exactly the observed active state UTxO;
- require the bound owner signer;
- preserve immutable owner/rescue/contact/threshold/inactivity configuration;
- advance heartbeat time from a bounded validity interval;
- clear approvals;
- preserve the protected value and beacon;
- source fees/collateral externally;
- construct evaluation and final unsigned candidates with no wallet key witness;
- add fail-closed tests for stale state, owner mismatch, changed rescue destination, changed contact set, value leakage and approval retention.

Workstation/network later:

- live Preprod evaluation;
- separately authorized owner signing;
- current-ledger pre-submit validation;
- separately authorized submission;
- inclusion/finality capture.

## Block C — Real contact approval

Remote engineering:

- consume exactly the latest heartbeat/state UTxO;
- enforce inactivity before approval;
- require one configured contact signer per approval transition;
- reject the owner as a substitute contact;
- reject duplicate contact approval;
- reject unconfigured contacts;
- preserve immutable rescue destination and all protected value;
- prove approval accumulation toward the configured threshold;
- keep contact authority separate from beneficiary/rescue authority.

For the genuine multi-party proof, trusted contacts must use independent wallet keys rather than accounts controlled by one wallet seed.

## Block D — Real execute / rescue

Remote engineering:

- require inactivity and threshold-approved state;
- consume exactly the active state UTxO;
- burn the state beacon exactly once;
- create no continuing active state output;
- direct the entire protected value to the immutable configured rescue destination;
- prohibit contact-controlled redirection;
- prohibit owner/contact/config mutation at execution;
- keep fees/collateral outside the protected value;
- add adversarial tests for wrong rescue address, partial payout, continuing beacon/state, insufficient approvals and premature execution.

Workstation/network later:

- live evaluation;
- required human wallet signatures;
- current-ledger validation;
- separately authorized submission;
- inclusion/finality;
- observed rescue balance.

## Block E — Recovery proof and promotion boundary

Only after all four real lifecycle actions are proven on public Preprod:

- bind initialize/heartbeat/approve/execute evidence into one lifecycle chain;
- prove every state transition spends the exact predecessor state;
- prove transaction inclusion/finality for each action;
- prove final rescue output/balance;
- prove no alternate destination received the protected value;
- run canonical invariant reconciliation;
- only then evaluate Cardano support-promotion eligibility.

## Authority matrix

| Stage | Network reads | Wallet signing | Submission | Support claim |
| --- | --- | --- | --- | --- |
| Remote construction/tests | No live requirement | No | No | No |
| Live evaluation | Yes | No | No | No |
| Wallet witness gate | Reads optional | Explicit human authorization only | No | No |
| Current-ledger validation | Yes | Already-signed bytes only | No | No |
| Submission | Yes | Already complete | Separate explicit human authorization | No |
| Inclusion/finality | Yes | No new signing | Already submitted | No |
| Full lifecycle proof | Yes | As action-specific gates require | As separately authorized | Still no automatic promotion |
