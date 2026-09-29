use aiken/collection/list
use aiken/crypto.{VerificationKeyHash}
use aiken/interval.{Finite}
use cardano/address.{Address}
use cardano/assets.{AssetName, Assets, PolicyId}
use cardano/transaction.{
  InlineDatum, Input, Output, OutputReference, Transaction,
}

pub type VaultDatum {
  VaultDatum {
    owner: VerificationKeyHash,
    rescue: Address,
    contacts: List<VerificationKeyHash>,
    threshold: Int,
    inactivity_ms: Int,
    last_heartbeat_ms: Int,
    approvals: List<VerificationKeyHash>,
  }
}

pub type VaultAction {
  Heartbeat
  Approve(VerificationKeyHash)
  Execute
}

fn exact_asset(
  policy_id: PolicyId,
  asset_name: AssetName,
  quantity: Int,
) -> Assets {
  assets.from_asset(policy_id, asset_name, quantity)
}

fn has_beacon(value: Assets, policy_id: PolicyId, asset_name: AssetName) -> Bool {
  assets.quantity_of(value, policy_id, asset_name) == 1
}

fn unique_set(items: List<a>) -> Bool {
  list.length(list.unique(items)) == list.length(items)
}

fn same_set(left: List<a>, right: List<a>) -> Bool {
  and {
    unique_set(left),
    unique_set(right),
    list.length(left) == list.length(right),
    list.all(left, fn(item) { list.has(right, item) }),
  }
}

fn valid_datum(datum: VaultDatum) -> Bool {
  and {
    datum.threshold > 0,
    datum.threshold <= list.length(datum.contacts),
    datum.inactivity_ms > 0,
    datum.last_heartbeat_ms >= 0,
    unique_set(datum.contacts),
    unique_set(datum.approvals),
    !list.has(datum.contacts, datum.owner),
    list.all(
      datum.approvals,
      fn(approval) { list.has(datum.contacts, approval) },
    ),
  }
}

fn finite_lower_bound(transaction: Transaction) -> Int {
  when transaction.validity_range.lower_bound.bound_type is {
    Finite(value) ->
      if transaction.validity_range.lower_bound.is_inclusive {
        value
      } else {
        value + 1
      }
    _ -> fail @"finite validity lower bound required"
  }
}

fn state_inputs(
  transaction: Transaction,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> Int {
  transaction.inputs
    |> list.count(
        fn(input) { has_beacon(input.output.value, policy_id, asset_name) },
      )
}

fn state_outputs(
  outputs: List<Output>,
  address: Address,
  policy_id: PolicyId,
  asset_name: AssetName,
) -> List<Output> {
  outputs
    |> list.filter(
        fn(output) {
          output.address == address && has_beacon(
            output.value,
            policy_id,
            asset_name,
          )
        },
      )
}

fn decode_inline_datum(output: Output) -> VaultDatum {
  expect InlineDatum(raw) = output.datum
  expect decoded: VaultDatum = raw
  decoded
}

fn policy_unchanged(current: VaultDatum, next: VaultDatum) -> Bool {
  and {
    current.owner == next.owner,
    current.rescue == next.rescue,
    current.contacts == next.contacts,
    current.threshold == next.threshold,
    current.inactivity_ms == next.inactivity_ms,
  }
}

fn recovery_eligible(datum: VaultDatum, lower_bound: Int) -> Bool {
  lower_bound >= datum.last_heartbeat_ms + datum.inactivity_ms
}

fn value_paid_to(outputs: List<Output>, address: Address) -> Assets {
  outputs
    |> list.filter(fn(output) { output.address == address })
    |> list.foldl(
        assets.zero,
        fn(output, total) { assets.merge(total, output.value) },
      )
}

validator state_beacon(seed: OutputReference, asset_name: AssetName) {
  mint(_redeemer: Void, own_policy: PolicyId, self: Transaction) {
    let minted_quantity = assets.quantity_of(self.mint, own_policy, asset_name)
    if minted_quantity == 1 {
      and {
        list.any(self.inputs, fn(input) { input.output_reference == seed }),
        self.mint == exact_asset(own_policy, asset_name, 1),
      }
    } else if minted_quantity == -1 {
      self.mint == exact_asset(own_policy, asset_name, -1)
    } else {
      False
    }
  }

  else(_) {
    fail
  }
}

validator recovery_vault(beacon_policy: PolicyId, beacon_name: AssetName) {
  spend(
    datum_opt: Option<VaultDatum>,
    action: VaultAction,
    own_ref: OutputReference,
    self: Transaction,
  ) {
    expect Some(datum) = datum_opt
    let own_input = transaction.resolve_input(self.inputs, own_ref)
    let lower_bound = finite_lower_bound(self)
    let continuations = state_outputs(
      self.outputs,
      own_input.address,
      beacon_policy,
      beacon_name,
    )

    expect valid_datum(datum)
    expect has_beacon(own_input.value, beacon_policy, beacon_name)
    expect state_inputs(self, beacon_policy, beacon_name) == 1

    when action is {
      Heartbeat -> {
        expect [next_output] = continuations
        let next = decode_inline_datum(next_output)
        and {
          list.has(self.extra_signatories, datum.owner),
          next_output.value == own_input.value,
          policy_unchanged(datum, next),
          next.last_heartbeat_ms == lower_bound,
          next.approvals == [],
          valid_datum(next),
        }
      }
      Approve(contact) -> {
        expect [next_output] = continuations
        let next = decode_inline_datum(next_output)
        and {
          recovery_eligible(datum, lower_bound),
          list.has(datum.contacts, contact),
          !list.has(datum.approvals, contact),
          list.has(self.extra_signatories, contact),
          next_output.value == own_input.value,
          policy_unchanged(datum, next),
          next.last_heartbeat_ms == datum.last_heartbeat_ms,
          same_set(next.approvals, [contact, ..datum.approvals]),
          valid_datum(next),
        }
      }
      Execute -> {
        let protected_value = own_input.value
          |> assets.add(beacon_policy, beacon_name, -1)
        and {
          recovery_eligible(datum, lower_bound),
          list.length(datum.approvals) >= datum.threshold,
          continuations == [],
          self.mint == exact_asset(beacon_policy, beacon_name, -1),
          value_paid_to(self.outputs, datum.rescue) == protected_value,
        }
      }
    }
  }

  else(_) {
    fail
  }
}

const test_owner: VerificationKeyHash =
  #"11111111111111111111111111111111111111111111111111111111"

const test_contact_a: VerificationKeyHash =
  #"22222222222222222222222222222222222222222222222222222222"

const test_contact_b: VerificationKeyHash =
  #"33333333333333333333333333333333333333333333333333333333"

const test_policy: PolicyId =
  #"44444444444444444444444444444444444444444444444444444444"

const test_name: AssetName = #"4f56"

const test_ref: OutputReference =
  OutputReference {
    transaction_id: #"abababababababababababababababababababababababababababababababab",
    output_index: 0,
  }

fn test_script_address() -> Address {
  address.from_script(
    #"55555555555555555555555555555555555555555555555555555555",
  )
}

fn test_rescue_address() -> Address {
  address.from_verification_key(
    #"66666666666666666666666666666666666666666666666666666666",
  )
}

fn test_datum(approvals: List<VerificationKeyHash>) -> VaultDatum {
  VaultDatum {
    owner: test_owner,
    rescue: test_rescue_address(),
    contacts: [test_contact_a, test_contact_b],
    threshold: 2,
    inactivity_ms: 60_000,
    last_heartbeat_ms: 100_000,
    approvals,
  }
}

fn test_vault_value() -> Assets {
  assets.from_lovelace(5_000_000)
    |> assets.add(test_policy, test_name, 1)
    |> assets.add(
        #"77777777777777777777777777777777777777777777777777777777",
        #"aa",
        12,
      )
}

fn test_input() -> Input {
  Input {
    output_reference: test_ref,
    output: Output {
      address: test_script_address(),
      value: test_vault_value(),
      datum: InlineDatum(test_datum([])),
      reference_script: None,
    },
  }
}

fn test_continuation(next: VaultDatum) -> Output {
  Output {
    address: test_script_address(),
    value: test_vault_value(),
    datum: InlineDatum(next),
    reference_script: None,
  }
}

test state_beacon_is_one_shot() {
  let transaction = Transaction {
    ..transaction.placeholder,
    inputs: [test_input()],
    mint: exact_asset(test_policy, test_name, 1),
  }
  state_beacon.mint(test_ref, test_name, Void, test_policy, transaction)
}

test heartbeat_resets_approvals_and_updates_liveness() {
  let current = test_datum([test_contact_a])
  let next = VaultDatum { ..current, approvals: [], last_heartbeat_ms: 170_000 }
  let transaction = Transaction {
    ..transaction.placeholder,
    inputs: [test_input()],
    outputs: [test_continuation(next)],
    validity_range: interval.after(170_000),
    extra_signatories: [test_owner],
  }
  recovery_vault.spend(
    test_policy,
    test_name,
    Some(current),
    Heartbeat,
    test_ref,
    transaction,
  )
}

test heartbeat_requires_owner_signature() fail {
  let current = test_datum([])
  let next = VaultDatum { ..current, last_heartbeat_ms: 170_000 }
  let transaction = Transaction {
    ..transaction.placeholder,
    inputs: [test_input()],
    outputs: [test_continuation(next)],
    validity_range: interval.after(170_000),
    extra_signatories: [test_contact_a],
  }
  recovery_vault.spend(
    test_policy,
    test_name,
    Some(current),
    Heartbeat,
    test_ref,
    transaction,
  )
}

test approval_is_inactivity_gated_and_adds_exactly_one_contact() {
  let current = test_datum([])
  let next = VaultDatum { ..current, approvals: [test_contact_a] }
  let transaction = Transaction {
    ..transaction.placeholder,
    inputs: [test_input()],
    outputs: [test_continuation(next)],
    validity_range: interval.after(160_000),
    extra_signatories: [test_contact_a],
  }
  recovery_vault.spend(
    test_policy,
    test_name,
    Some(current),
    Approve(test_contact_a),
    test_ref,
    transaction,
  )
}

test approval_before_inactivity_fails() fail {
  let current = test_datum([])
  let next = VaultDatum { ..current, approvals: [test_contact_a] }
  let transaction = Transaction {
    ..transaction.placeholder,
    inputs: [test_input()],
    outputs: [test_continuation(next)],
    validity_range: interval.after(159_999),
    extra_signatories: [test_contact_a],
  }
  recovery_vault.spend(
    test_policy,
    test_name,
    Some(current),
    Approve(test_contact_a),
    test_ref,
    transaction,
  )
}

test execute_burns_beacon_and_pays_exact_protected_value_to_rescue() {
  let current = test_datum([test_contact_a, test_contact_b])
  let protected = test_vault_value() |> assets.add(test_policy, test_name, -1)
  let rescue_output = Output {
    address: test_rescue_address(),
    value: protected,
    datum: transaction.NoDatum,
    reference_script: None,
  }
  let transaction = Transaction {
    ..transaction.placeholder,
    inputs: [test_input()],
    outputs: [rescue_output],
    mint: exact_asset(test_policy, test_name, -1),
    validity_range: interval.after(160_000),
  }
  recovery_vault.spend(
    test_policy,
    test_name,
    Some(current),
    Execute,
    test_ref,
    transaction,
  )
}

test execute_rejects_redirection() fail {
  let current = test_datum([test_contact_a, test_contact_b])
  let wrong_output = Output {
    address: address.from_verification_key(
      #"88888888888888888888888888888888888888888888888888888888",
    ),
    value: test_vault_value() |> assets.add(test_policy, test_name, -1),
    datum: transaction.NoDatum,
    reference_script: None,
  }
  let transaction = Transaction {
    ..transaction.placeholder,
    inputs: [test_input()],
    outputs: [wrong_output],
    mint: exact_asset(test_policy, test_name, -1),
    validity_range: interval.after(160_000),
  }
  recovery_vault.spend(
    test_policy,
    test_name,
    Some(current),
    Execute,
    test_ref,
    transaction,
  )
}
