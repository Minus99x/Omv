import { getChain } from '../chains/registry.js';
import { VaultStatus } from './recovery.js';

function unique(values) {
  return [...new Set(values)];
}

function check(id, ok, details = {}) {
  return Object.freeze({ id, ok: ok === true, ...details });
}

export function assessRecoveryReadiness(vault, { compatibility = null } = {}) {
  const chain = getChain(vault?.chainId);
  const contacts = Array.isArray(vault?.trustedContacts) ? vault.trustedContacts : [];
  const uniqueContacts = unique(contacts);
  const threshold = Number(vault?.threshold);

  const ownerStatus = check(
    'owner-status',
    Boolean(chain && chain.validateAccount(vault?.owner) && vault?.status !== VaultStatus.RECOVERED),
    {
      owner: vault?.owner ?? null,
      vaultStatus: vault?.status ?? null,
      lastHeartbeatAt: vault?.lastHeartbeatAt ?? null
    }
  );

  const viableQuorum = check(
    'viable-quorum',
    Number.isInteger(threshold) && threshold >= 1 && uniqueContacts.length >= threshold,
    {
      threshold: Number.isInteger(threshold) ? threshold : null,
      configuredContacts: contacts.length,
      uniqueContacts: uniqueContacts.length
    }
  );

  const trustedContacts = check(
    'trusted-contacts',
    Boolean(
      chain &&
      contacts.length > 0 &&
      contacts.length === uniqueContacts.length &&
      contacts.every(account => chain.validateAccount(account)) &&
      !contacts.includes(vault?.owner) &&
      !contacts.includes(vault?.rescueDestination)
    ),
    { count: contacts.length }
  );

  const rescueConfiguration = check(
    'rescue-configuration',
    Boolean(
      chain &&
      chain.validateAccount(vault?.rescueDestination) &&
      vault?.rescueDestination !== vault?.owner &&
      !contacts.includes(vault?.rescueDestination) &&
      (!vault?.recovery || vault.recovery.destination === vault.rescueDestination)
    ),
    {
      rescueDestination: vault?.rescueDestination ?? null,
      pendingDestination: vault?.recovery?.destination ?? null
    }
  );

  const compatibilityMigration = check(
    'compatibility-migration',
    Boolean(
      compatibility &&
      compatibility.compatible === true &&
      compatibility.migrationRequired !== true
    ),
    {
      compatible: compatibility?.compatible === true,
      migrationRequired: compatibility?.migrationRequired ?? null,
      ref: compatibility?.ref ?? null
    }
  );

  const checks = Object.freeze([
    ownerStatus,
    viableQuorum,
    trustedContacts,
    rescueConfiguration,
    compatibilityMigration
  ]);
  const ready = checks.every(item => item.ok);

  return Object.freeze({
    schema: 'omegavault.recovery-readiness.v1',
    chainId: vault?.chainId ?? null,
    ready,
    checks,
    failedChecks: Object.freeze(checks.filter(item => !item.ok).map(item => item.id))
  });
}
