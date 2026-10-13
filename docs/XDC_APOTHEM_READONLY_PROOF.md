# XDC Apothem — first verified live read-only RPC milestone

**Network:** XDC Apothem Testnet, chain ID 51 (`0x33`). This is reconnaissance and **not** a proof of successful deployment, signing, recovery, finality or production support.

On October 12, 2026 (Phoenix date), a one-shot isolated GitHub CI runner used the public Apothem endpoint to execute four **read-only** JSON-RPC calls with response identity and consistency checks: `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber`, and `eth_gasPrice`.

## Verified public RPC observation

- [Successful XDC Apothem read-only proof](https://github.com/Minus99x/Omegavault/actions/runs/38345382962).
- Network RPC endpoint: `https://rpc.apothem.network` (fixed testnet-only).
- Observed chain ID: `0x33` (decimal 51).
- Block number: **84,027,167**.
- Observed block hash: `0x6e2eb066da6c4dcb7567d95ad15671ff674b7c74db947158d02a15192a7fcc8d`.
- Parent hash: `0x077169c21af88f8a0dd4af53c81dd3bea08fbbaf16beb5b14550e2361b25c5d4`.
- Block timestamp (Unix seconds): `1791864808`.
- RPC gas-price quote: `625000000000` wei, equivalent to **625 gwei**.

The observed gas-price quote is far above the 0.25-gwei figure appearing in some XDC documentation. These values are a single observation and **not** a reliable fee estimate for a deployment. Next steps must independently cross-check gas, EVM fee mode, chain configuration and deployed runtime bytecode before any meaningful gas budget or support claim.

The probe is implemented as `scripts/xdc-apothem-readonly-probe.js` with offline negative tests in `test/xdc-apothem-readonly-probe.test.js`. Its test rejects mismatched mainnet identity, wrong block heights/hashes, malformed quantities and incompatible JSON-RPC responses. No account, wallet, private key, signed transaction, or testnet value was involved.

## Independent two-provider Apothem consensus and gas quote — 2026-10-12

The read-only `scripts/xdc-apothem-independent-rpc-check.js` now checks chain ID 51 at **two independently addressed Apothem JSON-RPC endpoints**, obtains each provider's tip, queries the *exact same shared block height* at both, requires byte-for-byte matching block hashes, and compares the two `eth_gasPrice` responses.

- [Successful live provider comparison](https://github.com/Minus99x/Omegavault/actions/runs/38347097320).
- Endpoints: `https://rpc.apothem.network` and `https://erpc.apothem.network`.
- Both reported decimal chain ID **51** and tip **84,027,733**.
- Matching shared block hash: `0x53d1691e1da9a58a079d9d307b8cd7ca4479992d8538d4578ab16c522abd8ad2`.
- Both independently reported an `eth_gasPrice` quote of **625,000,000,000 wei = 625 gwei**, zero quote divergence in this observation.
- All four read-only methods used per provider were `eth_chainId`, `eth_blockNumber`, `eth_getBlockByNumber` and `eth_gasPrice`. No keys, transactions, deployers, user wallets, tokens or value were used.
- An initial comparison against the documentation-listed `rpc.apothem.blocksscan.io` [failed because fetch failed](https://github.com/Minus99x/Omegavault/actions/runs/38346664282); this was a provider-connectivity issue, not chain-consensus evidence. An alternative published Apothem endpoint was selected for an independent retry. The code's request errors now identify the failing endpoint.

**Important:** Confirmed identical quote does **not** determine safe contract-deployment fees, EIP-1559 support, gas estimation, node submission acceptance, or XDPoS finality. The unusually high `eth_gasPrice` relative to older official network documentation remains a budget concern. The actual deployment gas and fee mechanism must be tested in a narrowly capped, independently funded Testnet objective before deployment is attempted. `xdc:apothem` remains `compatibility-ready`, not a released connector.

## Exact V0.5 contract deployment estimate — 2026-10-12

[Successful public Apothem read-only deployment preflight](https://github.com/Minus99x/Omegavault/actions/runs/38351155613) compiled the existing `contracts/OmegaVaultRecoveryVaultV050.sol` with pinned `solc 0.8.24`, Paris EVM target and optimizer (200 runs) without using wallet credentials or sending a transaction.

- Compiled creation bytecode: **5,273 bytes**; deployed runtime bytecode: **4,242 bytes**.
- Canonical ABI parameters: two distinct disposable guardians, **2-of-2 threshold**, **45-second inactivity**, fixed distinct rescue address, and disposable dry-run deployer address with **no associated private key**.
- Both independent Apothem providers agreed on common block **84,029,077**, hash `0x217cb58e0d0de59b55079986fe71aa93a2d71930dd1f8feafe946d9fa815138c`, 625-gwei gas quote and 625-gwei block `baseFeePerGas`.
- Both accepted the identical **read-only** `eth_estimateGas` constructor simulation: **1,358,864 gas**.
- With a conservative 25% gas cushion, cap is **1,698,580 gas**, or **1.0616125 fake TXDC** at that observed fee. This is below the explicitly capped **5 fake TXDC** per-deployment budget.
- The preflight **does not authorize actual signing, funding, deployment or recovery** and does not prove the present cost quote will persist.

The compiler-checked preflight source is `scripts/xdc-apothem-deployment-preflight.js`; strict budget and constructor encoder tests are in `test/xdc-apothem-deployment-budget.test.js`.

## Local EVM reproduction of real V0.5 source — 2026-10-12

[Successful one-shot local chain-51 rehearsal](https://github.com/Minus99x/Omegavault/actions/runs/38351457906) used pinned dependencies to deploy the **same Solidity V0.5 source** on an isolated Ganache chain configured with ID 51. This is **not public XDC Apothem** and does not make the connector recovery-proven.

Verified in locally mined EVM transactions: owner and rescue configuration; native deposit and exact 1-unit rescue transfer; non-guardian and premature guardian rejection; owner-signed heartbeat resetting the inactivity period and clearing prior approval; mandatory 2-of-2 guardian threshold; permissionless execute after approval; replay/double recovery rejection; post-recovery mock-token sweep of 1,000,000 units; and failure of owner heartbeat after final recovery. Reported final native recovery execution used **39,716 gas** in the isolated emulator.

Harness: `scripts/xdc-apothem-local-recovery-rehearsal.js`. **No public-network transaction, faucet, customer key, or real assets** were touched.

## V0.5 adversarial finding and isolated V0.5.1 correction — 2026-10-13

A purpose-built [successful isolated EVM security audit](https://github.com/Minus99x/Omegavault/actions/runs/38393273181) exercised the **unaltered** `OmegaVaultRecoveryVaultV050.sol` on a disposable Ganache chain configured with chain ID 51.

It verified six malformed constructor policies revert (empty contact set, duplicate contacts, impossible threshold, zero inactivity, owner as contact, destination as contact), pre-recovery token sweeping is forbidden, invalid/zero token addresses are rejected, repeat zero-balance token sweeping cannot duplicate a payout and owner withdrawal is disabled after final recovery.

**Material defect in V0.5, actually reproduced:** `receive()` accepts a new native-value transfer **after** `recovered` becomes true, but `executeRecovery()` cannot run twice and `ownerWithdraw()` is disabled once recovered. Therefore a normal late native deposit can become stranded. This candidate must not be the target of a new public Apothem deployment until fixed and revalidated.

A **separate new source candidate**, `contracts/OmegaVaultRecoveryVaultV051.sol`, changes the adapter version to 501 and adds a permissionless `recoverLateNative()` guarded by `recovered`. Its sole payout target is the preconfigured immutable `rescueDestination`; the original V0.5 source and previously recorded gas estimate remain unchanged.

[Verified isolated V0.5.1 safety run](https://github.com/Minus99x/Omegavault/actions/runs/38393575216) compiled the new source with pinned Solidity 0.8.24, completed genuine local 2-of-2 native recovery, rejected an early late-native sweep, then deposited **137 wei** after recovery and transferred exactly those 137 wei to the same immutable rescue address. An empty second sweep did not credit extra value. This remains **local simulated chain execution**, not public XDC recovery or a security audit.

**Required before the public Apothem attempt:** Pin and independently compare V0.5.1 compiled runtime/creation bytecode, repeat gas estimates on both testnet RPCs for this changed source, revisit reentrancy and malicious-recipient scenarios, and use only fresh disposable faucet-funded accounts with a strict maximum fake-token fee cap. Do **not** reuse the V0.5 deployment estimate as though it applies to V0.5.1. Re-evaluate forced native transfers and smart-contract recipient compatibility separately.

## V0.5.1 independent Apothem candidate estimate — 2026-10-13

[Successful separate V0.5.1 live read-only preflight](https://github.com/Minus99x/Omegavault/actions/runs/38479434005) compiled **the corrected V0.5.1 source itself**, never substituting the older V0.5 fee estimate. A two-item allowlist selects exactly the existing V0.5 baseline or corrected V0.5.1 source; arbitrary file paths and variants fail before RPC access.

- Compiler: pinned **Solidity 0.8.24**, Paris EVM, optimizer 200 runs; creation bytecode **5,613 bytes**, runtime bytecode **4,568 bytes**.
- Official and eRPC Apothem providers agreed on chain **51**, common block **84,056,421** (hash `0xfa1eff98b11ad137e8529e29c50fbb843f3114514dc18fa394c3b04b447bbe37`), base fee **625 gwei** and gas quote **625 gwei**.
- Both independently simulated the same 2-of-2/45-second recovery deployment bytecode at **1,442,885 gas**; conservative 25%-buffered limit **1,803,607 gas**, estimated maximum **1.127254375 fake TXDC** at the observed quote.
- The estimated fee remained below a fixed **5 fake TXDC** deployment ceiling. This is a *read-only RPC simulation with an unowned placeholder deployer address*. No actual wallet was funded, transaction signed/broadcast or new XDC contract deployed.
- The estimate is a historical public-testnet observation, not a standing quote, fee reservation or authorization. Repeat with funded disposable identities and explicit fee-mode/balance checks immediately before any future real deployment.

## Rejecting rescue contract: isolated transaction-atomicity proof — 2026-10-13

[Successful V0.5.1 recipient-failure run](https://github.com/Minus99x/Omegavault/actions/runs/38479601695) deployed a disposable Solidity `RefusingRescue` smart contract and configured it as the immutable beneficiary of a fresh two-guardian V0.5.1 vault **only on local Ganache chain 51**.

- After the 45-second inactivity wait, both guardian approvals succeeded and the vault held exactly 1 simulated native coin.
- The destination smart contract explicitly rejected plain native payment; `executeRecovery()` **reverted** rather than marking the vault recovered or losing funds.
- On-ledger *local-emulator* state checks confirmed `recovered === false`, **both guardian approvals remained present**, the full vault native balance was still intact, and the rejecting recipient had received zero.
- This is **safe transaction atomicity**, not successful recoverability for an incompatible recipient: because the rescue address is immutable, users must choose an address capable of accepting native value. Restrict the first public Apothem proof to a fresh disposable externally owned rescue account, verify address classification, and test recipient compatibility separately before ever supporting arbitrary smart-contract beneficiaries.
- The same run also preserved prior positive two-guardian recovery, 137-wei post-recovery late-native payout, and empty-repeat-sweep invariants.

This proof does not replace independent audit, public XDC transaction receipts, XDPoS finality, or production wallet security.

## Funding boundary for the first public-Testnet recovery

The [official Apothem faucet](https://faucet.apothem.network/) requires a wallet address and CAPTCHA according to its documented workflow. No authenticated, documented unattended claim method has been established in this campaign. A **fresh disposable Apothem deployer wallet** must therefore be funded with faucet tokens through an authorized user action before any genuine testnet deployment can be claimed. Do not substitute user-controlled mainnet or existing production wallet keys, copy a private key into git/CI logs, or bypass the faucet's anti-abuse checks.

Next proof: on-chain deployment with a strict ≤5 fake-TXDC gas budget, runtime-bytecode and immutable-policy verification, owner heartbeat, guardian threshold, real rescue balance transfer, public receipt/finality evidence and token recovery if applicable. Independent review and existing maturity gates remain intact.

## Next XDC objective

1. Re-check the current real deployment gas quote and base fee immediately before any funded transaction; do not assume the recorded estimate remains valid.
2. Prepare disposable Apothem accounts and a bounded fee budget using faucet tokens only.
3. Reproduce OmegaVault's Ethereum Solidity proof on Apothem with XDC-specific chain identity/address handling. Verify deployed runtime bytecode and owner/contact/rescue configuration on-chain.
4. Execute real testnet native recovery, heartbeat and threshold guards, then XDC finality and (if implemented) token-sweep checks.
5. Submit support evidence for independent maturity reconciliation; **no automatic promotion**.

The chain-specific model remains independent of Cardano and the Stellar native signer pathway.
