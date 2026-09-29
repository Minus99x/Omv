# OmegaVault MVP 0.4 Internal Security Review

## Custody-boundary review

Searched application/server code for wallet-secret collection paths. The intended interface accepts public addresses, public chain state, transaction hashes, receipts, and signatures. No form field, API route, or persistence field is defined for a seed phrase/private key.

Security invariant for future work:

> No OmegaVault server endpoint or normal UI flow should ever request or accept a recovery phrase/private key.

## Test/mainnet boundary

Three independent controls remain in MVP 0.4:

1. browser adapter refuses proof deployment/actions when the wallet is not on Sepolia
2. server refuses to bind an Ethereum proof whose network reference is not Sepolia
3. server refuses an Ethereum proof binding unless it is explicitly marked test-only and verified

The runtime config also reports that production value and mainnet transactions are disabled.

## Deployment identity

Before a deployment becomes an OmegaVault binding, the client verifies:

- code exists
- runtime bytecode equals the local compiled artifact after masking compiler-declared immutable ranges
- owner
- rescue destination
- threshold
- test inactivity period
- adapter version constant
- trusted-contact membership

The binding stores source SHA-256 and version metadata for later auditability. `contracts/manifest.json` now records the exact expected source hash, compiler version/settings, test-network identity, and deployment policy. `npm run check` fails if the checked-in Solidity source no longer matches that manifest.

## Connector isolation

The chain registry now uses a common adapter-definition contract. Every connector declares its own:

- account model
- transaction model
- signing model
- recovery mechanism
- implementation stage
- capabilities
- security notes

XRPL, Solana, Bitcoin, and XDC remain scaffolds; they are not represented as "Ethereum with a different RPC." Automated tests assert that the major non-EVM connectors do not inherit Ethereum transaction/signing models.

## Property/invariant testing added

Deterministic sweeps now exercise hundreds of Core state transitions and assert:

- repeated votes from one trusted contact never satisfy a larger threshold
- unique trusted contacts reach `recovery_ready` exactly at threshold
- owner heartbeat clears both pending and threshold-ready recovery state
- requester input can never substitute a different rescue destination

These tests complement scenario unit tests; they are not a substitute for Solidity-level fuzzing.

## Static Solidity sanity gates added

Automated checks currently assert:

- no `delegatecall`
- no `tx.origin`
- no `selfdestruct`
- `recovered = true` is set before the external recovery transfer
- owner/rescue destination/inactivity/threshold are immutable
- source hash matches the checked-in manifest

These are regression guardrails, not a professional contract audit.

## Known proof-contract design limitations

- the proof holds only native Sepolia ETH; ERC-20/NFT handling is not implemented
- an immutable rescue destination that cannot receive ETH could cause recovery execution to revert indefinitely
- contact approval requires each approving account to have gas
- timestamp-based inactivity inherits normal block-timestamp limitations
- the approval reset loop is bounded to 32 contacts in the Ethereum proof but still has chain-specific gas cost
- the proof demonstrates a vault-transfer model, not necessarily the final production recovery architecture

## Remaining high-priority items before any production consideration

1. independent server-side RPC verification and reorg/finality policy
2. pin exact compiler JavaScript checksum + reproducible build procedure
3. executable Solidity test suite in Foundry/Hardhat or equivalent
4. Solidity fuzz/property and invariant testing
5. static analyzers (e.g. Slither-equivalent) and symbolic/formal analysis where useful
6. professional external Solidity audit
7. production asset-control decision: dedicated vault vs smart account/recovery module
8. adversarial recipient/reentrancy/gas-griefing tests
9. token/NFT recovery model designed and audited separately
10. authenticated/persistent user storage rather than local JSON
11. encrypted sensitive metadata where applicable
12. CSRF/session/authentication design once accounts exist
13. rate limiting and abuse controls for hosted APIs
14. monitoring/alerting and recovery notifications
15. chain-specific threat model and live test suite for every additional connector
16. privacy review for analytics/ad attribution before launch
