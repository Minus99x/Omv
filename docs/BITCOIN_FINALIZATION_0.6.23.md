# Bitcoin recovery finalization — 0.6.23-dev

OmegaVault now has a strict source-level finalization path for its reduced-semantics Bitcoin recovery design. It validates the exact configured P2WSH descriptor, block-based CSV sequence, configured recovery signer set and threshold, requires a single confirmed rescue output and exact fee, then assembles the delayed recovery witness and SegWit transaction serialization.

The witness recovery branch is constructed as the CHECKMULTISIG dummy element, threshold contact signatures in descriptor key order, an empty owner signature selecting the delayed branch, and the witness script. The transaction serializer emits both traditional and witness forms so txid and wtxid can be derived separately.

This hardening protects transactions produced by OmegaVault. It does not create a Bitcoin covenant and therefore cannot stop the threshold key holders from constructing a different valid spend outside OmegaVault after CSV maturity. The connector remains reduced semantics.

Full cryptographic execution of the new finalizer is pending restoration of the pinned `@noble/curves` dependency in the current execution workspace.
