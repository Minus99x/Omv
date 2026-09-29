function cloneState(state) {
  return {
    ...state,
    approvals: new Set(state.approvals),
    audit: [...state.audit]
  };
}

export function createRecoverySimulation({ owner, contacts, threshold, inactivitySeconds, rescueDestination, startTime = 0, balance = 0n }) {
  if (!owner || !rescueDestination) throw new TypeError('Simulation requires owner and rescueDestination.');
  if (!Array.isArray(contacts) || !contacts.length) throw new TypeError('Simulation requires contacts.');
  if (!Number.isInteger(threshold) || threshold < 1 || threshold > contacts.length) throw new TypeError('Simulation threshold must be reachable.');
  if (!Number.isInteger(inactivitySeconds) || inactivitySeconds < 1) throw new TypeError('Simulation inactivitySeconds must be positive.');
  return Object.freeze({
    owner,
    contacts: Object.freeze([...contacts]),
    threshold,
    inactivitySeconds,
    rescueDestination,
    state: Object.freeze({
      lastHeartbeat: Number(startTime),
      approvals: Object.freeze([]),
      recovered: false,
      balance: BigInt(balance).toString(),
      rescued: '0',
      audit: Object.freeze([])
    })
  });
}

export function runRecoverySimulation(simulation, events) {
  const contacts = new Set(simulation.contacts);
  let state = {
    lastHeartbeat: simulation.state.lastHeartbeat,
    approvals: new Set(simulation.state.approvals),
    recovered: simulation.state.recovered,
    balance: BigInt(simulation.state.balance),
    rescued: BigInt(simulation.state.rescued),
    audit: [...simulation.state.audit]
  };
  const resultEvents = [];

  for (const event of events) {
    const next = cloneState(state);
    const at = Number(event.at);
    if (!Number.isFinite(at) || at < 0) throw new TypeError('Simulation event time must be non-negative.');
    let ok = true;
    let error = null;
    const eligible = at >= state.lastHeartbeat + simulation.inactivitySeconds;

    if (event.type === 'heartbeat') {
      if (event.actor !== simulation.owner) { ok = false; error = 'OnlyOwner'; }
      else if (state.recovered) { ok = false; error = 'AlreadyRecovered'; }
      else { next.lastHeartbeat = at; next.approvals.clear(); }
    } else if (event.type === 'approve') {
      if (!contacts.has(event.actor)) { ok = false; error = 'NotTrustedContact'; }
      else if (state.recovered) { ok = false; error = 'AlreadyRecovered'; }
      else if (!eligible) { ok = false; error = 'InactivityNotElapsed'; }
      else next.approvals.add(event.actor);
    } else if (event.type === 'execute') {
      if (state.recovered) { ok = false; error = 'AlreadyRecovered'; }
      else if (!eligible) { ok = false; error = 'InactivityNotElapsed'; }
      else if (state.approvals.size < simulation.threshold) { ok = false; error = 'ThresholdNotMet'; }
      else { next.recovered = true; next.rescued += next.balance; next.balance = 0n; }
    } else if (event.type === 'deposit') {
      if (state.recovered) { ok = false; error = 'AlreadyRecovered'; }
      else {
        const amount = BigInt(event.amount);
        if (amount <= 0n) { ok = false; error = 'InvalidAmount'; }
        else next.balance += amount;
      }
    } else {
      throw new TypeError(`Unknown simulation event: ${event.type}`);
    }

    const audit = Object.freeze({ type: event.type, actor: event.actor ?? null, at, ok, error });
    next.audit.push(audit);
    if (ok) state = next;
    else state.audit.push(audit);
    resultEvents.push(audit);
  }

  return Object.freeze({
    owner: simulation.owner,
    rescueDestination: simulation.rescueDestination,
    threshold: simulation.threshold,
    inactivitySeconds: simulation.inactivitySeconds,
    finalState: Object.freeze({
      lastHeartbeat: state.lastHeartbeat,
      approvals: Object.freeze([...state.approvals]),
      recovered: state.recovered,
      balance: state.balance.toString(),
      rescued: state.rescued.toString()
    }),
    events: Object.freeze(resultEvents),
    audit: Object.freeze([...state.audit])
  });
}

export const RECOVERY_SIMULATION_FIXTURES = Object.freeze({
  happyPath: Object.freeze([
    Object.freeze({ type: 'deposit', at: 1, actor: 'owner', amount: '1000' }),
    Object.freeze({ type: 'approve', at: 61, actor: 'contact-a' }),
    Object.freeze({ type: 'approve', at: 62, actor: 'contact-b' }),
    Object.freeze({ type: 'execute', at: 63, actor: 'anyone' })
  ]),
  duplicateApproval: Object.freeze([
    Object.freeze({ type: 'approve', at: 61, actor: 'contact-a' }),
    Object.freeze({ type: 'approve', at: 62, actor: 'contact-a' })
  ]),
  heartbeatReset: Object.freeze([
    Object.freeze({ type: 'approve', at: 61, actor: 'contact-a' }),
    Object.freeze({ type: 'heartbeat', at: 62, actor: 'owner' }),
    Object.freeze({ type: 'execute', at: 63, actor: 'anyone' })
  ])
});
