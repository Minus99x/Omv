# XDC Apothem V0.5.1 — one-console-session disposable public-Testnet objective

**Status:** Development-only operator package. Not an XDC deployment, audit, XRC-20 live test, confirmed XDPoS finality, or permission to use real assets. Only disposable free-faucet TXDC, fixed public Apothem chain ID **51**.

## Work already done without operator wallet access

- Compiled V0.5.1 (the corrected late-native recovery candidate) with pinned `solc@0.8.24`. The original V0.5 remains blocked due to proven stranded late deposits.
- Independently estimated V0.5.1 at **1,442,885 gas** from two public Apothem providers with a then-current **625-gwei** quote; 25% buffered fee estimate **1.127254375 fake TXDC**. The quote may change.
- Verified locally the native recovery lifecycle and its atomic rollback on an incompatible recipient.
- Created a standalone local-encrypted identity generator, read-only funding inspector and strictly opt-in public-testnet executor. All signing belongs on the operator's local computer, not GitHub Actions or the assistant.

## Once the operator is at a console

Use the existing OmegaVault development branch `dev/0.6.60-reconcile-overnight-bitcoin`. From the repository root, install the fixed optional signer dependency without updating the tracked `package.json` or `package-lock.json`:

```powershell
npm ci --ignore-scripts
npm install --no-save --package-lock=false --ignore-scripts ethers@6.13.4
node scripts/xdc-apothem-disposable-wallet.js prepare
```

The last command prompts twice for a **local encryption passphrase** (12+ characters, terminal input not echoed). It generates **four fresh unique disposable accounts**, locally encrypts their keys and saves the keystores under `~/.omegavault-test/xdc-apothem-disposable` (Windows: current user's home directory). The program prints **public addresses only**. These are *not* the owner's MetaMask/Yoroi/other existing wallet accounts. Never paste passwords, seeds, private keys, `secrets.json`, or GitHub CI secrets into chat or a repository.

1. Copy only the printed **owner faucet address** into the [official Apothem faucet](https://faucet.apothem.network/). Complete the faucet's normal human verification. The intended first-use balance is **at least 3 disposable fake TXDC**. The faucet may provide a smaller amount or be unavailable; stop rather than bypass its policies. The guardian accounts will be funded from the disposable owner by the bounded local executor, avoiding additional faucet requests.
2. Verify chain-51 balances and code-free rescue destination via two public Apothem RPCs:

```powershell
node scripts/xdc-apothem-disposable-wallet.js status
```

The read-only status queries **no private keys**. Do not continue if it reports `fundingVerified: false` or `rescueHasNoCodeOnBothProviders` is absent.
3. After reviewing the budget and **only when ready to make public-Testnet transactions**, the operator may explicitly enable the local proof:

```powershell
$env:OMEGAVAULT_XDC_APOTHEM_DISPOSABLE_LIVE='PUBLIC_APOTHEM_FAKE_TXDC_ONLY'
node scripts/xdc-apothem-disposable-live.js
```

This **spends only free Testnet TXDC**, but does cause real transactions on the public Apothem testnet. The script requests the local encryption passphrase without echoing it. It independently rechecks the fixed testnet chain, current V0.5.1 creation estimate and the five-fake-TXDC cumulative transaction-fee ceiling before signing.

## Intended single-use on-chain sequence

1. Deploy the compiled **V0.5.1** recovery bytecode using the disposable owner. Require a successful included receipt; compare the entire deployed runtime bytecode apart from the exact compiler-declared immutable slots.
2. Verify the owner, exactly two independent guardians, **2-of-2 threshold**, 45-second inactivity, immutable EOA rescue destination, and adapter version 501 using contract reads. Reject unexpected configuration.
3. Fund the disposable guardian accounts with 0.1 fake TXDC each, put 0.1 fake TXDC in the vault, submit an owner heartbeat and verify premature guardian approval is rejected by an `eth_call` **anchored to that heartbeat's confirmed inclusion block and exact receipt block hash**. A differing canonical block hash stops the trial for manual reorganization reconciliation; using the historical block also prevents confirmation delays from crossing the 45-second inactivity window before the check. The RPC must expose the exact Solidity `InactivityNotElapsed()` custom error; an unrelated revert or missing revert data does not qualify as proof.
4. Wait for the actual chain's timestamp to pass the heartbeat inactivity threshold, submit the two guardian approvals, prove that one approval fails with the exact Solidity `ThresholdNotMet()` custom error (not a generic revert), and execute the recovery. Verify **exactly 0.1 fake TXDC** credited to the rescue address, a zero vault native balance and `recovered=true`.
5. Deliver **137 wei** to the already-recovered vault; execute `recoverLateNative()` and verify the exact same 137 wei arrives at the immutable rescue address.
6. Record transaction hashes, blocks, actual fee amounts, owner/guardian/beneficiary identity checks and the on-chain runtime match in **local public-data-only** `execution-journal.json`. **Before declaring success**, independently re-read all ten transaction receipts and their canonical block hashes against both public Apothem RPCs, reconcile actual cumulative fees with the journal, verify the deployed runtime bytecode on the second provider and confirm its final recovered/empty-vault state. Any missing or conflicting public evidence must halt for manual reconciliation, not be silently counted as proof. Two receipt confirmations and agreement between two RPCs are **not** independently established XDPoS finality. Token sweeping remains an independent later proof.

## Strict limits and interruption handling

- All public RPCs are fixed to `rpc.apothem.network` and the independently checked `erpc.apothem.network`. **No mainnet RPC, private keys supplied to GitHub CI, customer wallet, browser extension signing, seed import, or value-bearing mainnet asset.**
- The maximum aggregate actual network fee is **5 fake TXDC**, including deployment, guardian funding, heartbeat, approvals, recovery and late-native sweep. Every transaction uses fresh `eth_estimateGas`, a 25% gas buffer, and a 1000-gwei gas-price cutoff. This cap covers fees; separate **0.1 fake TXDC** recovery value and guardian test top-ups are visible in the local public journal. If fees spike or balances are inadequate, stop instead of overriding limits.
- **Do not restart `execute` on failure.** Before the first possible broadcast it exclusively creates a local journal. Each bounded chain-51 transaction is signed locally, and its deterministic hash and nonce are written to the journal **before** its raw bytes are broadcast. If an RPC accepts the broadcast but drops the response, a `broadcasting` entry still contains the transaction hash: use public Apothem transaction/receipt and sender-nonce reads to reconcile it. A missing receipt immediately after a timeout is **not** proof that the transaction was rejected. Preserve the journal; never remove it or resubmit automatically. Raw signed transaction bytes and wallet secrets are never saved in the journal.
- For the first trial the rescue **must be an externally owned disposable account** with no bytecode, verified on two independent RPCs. The local failure test demonstrated that a contract destination refusing a transfer prevents recovery, even though the failed transaction leaves existing approvals and funds unchanged.
- The encrypted keystore is **not recoverable** if the passphrase or local file is lost. These test keys must never be reused for user funds.

## Genuine proof requirements

The label *public XDC recovery proven* applies only after independently checkable Apothem transaction receipts, bytecode/policy verification, exact transfer conservation and observed block identity. It does **not** automatically promote XDC to production, authorize mainnet, establish on-chain XRC-20 sweep, demonstrate XDPoS finality, or replace independent security review.

The already-proven Stellar, Cardano, and Ethereum objectives retain separate chain-specific evidence gates.
