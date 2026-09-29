function strip0x(value) {
  return String(value ?? '').replace(/^0x/i, '');
}

function assertHex(value, label) {
  if (!/^[0-9a-fA-F]*$/.test(value)) throw new Error(`${label} must be hexadecimal.`);
}

function assertEvenHex(value, label) {
  assertHex(value, label);
  if (value.length % 2 !== 0) throw new Error(`${label} must contain whole bytes.`);
}

export function encodeUintWord(value) {
  const n = BigInt(value);
  if (n < 0n || n >= (1n << 256n)) throw new Error('Unsigned integer is outside uint256 range.');
  return n.toString(16).padStart(64, '0');
}

export function encodeAddressWord(address) {
  const hex = strip0x(address);
  assertHex(hex, 'Address');
  if (hex.length !== 40) throw new Error('Ethereum address must contain 20 bytes.');
  return hex.toLowerCase().padStart(64, '0');
}

export function encodeRecoveryConstructor({ trustedContacts, threshold, inactivitySeconds, rescueDestination }) {
  if (!Array.isArray(trustedContacts) || trustedContacts.length === 0) throw new Error('At least one trusted contact is required.');
  if (trustedContacts.length > 32) throw new Error('The Ethereum proof adapter supports at most 32 trusted contacts.');
  const head = [
    encodeUintWord(128),
    encodeUintWord(threshold),
    encodeUintWord(inactivitySeconds),
    encodeAddressWord(rescueDestination)
  ];
  const tail = [
    encodeUintWord(trustedContacts.length),
    ...trustedContacts.map(encodeAddressWord)
  ];
  return head.join('') + tail.join('');
}

export function makeDeploymentData(bytecode, constructorArgs) {
  const code = strip0x(bytecode);
  assertEvenHex(code, 'Contract bytecode');
  if (!code.length) throw new Error('Compiled contract bytecode is empty.');
  return `0x${code}${encodeRecoveryConstructor(constructorArgs)}`;
}

export function methodData(methodIdentifiers, signature) {
  const selector = methodIdentifiers?.[signature];
  if (!selector || !/^[0-9a-fA-F]{8}$/.test(selector)) throw new Error(`Compiled method selector missing for ${signature}.`);
  return `0x${selector}`;
}

export function methodDataWithAddress(methodIdentifiers, signature, address) {
  return `${methodData(methodIdentifiers, signature)}${encodeAddressWord(address)}`;
}

export function toHexQuantity(value) {
  const n = BigInt(value);
  if (n < 0n) throw new Error('JSON-RPC quantity cannot be negative.');
  return `0x${n.toString(16)}`;
}

export function parseEther(value) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{0,18})?$/.test(text)) throw new Error('ETH amount must be a non-negative number with at most 18 decimals.');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 10n ** 18n + BigInt((fraction + '0'.repeat(18)).slice(0, 18));
}

export function decodeUintWord(hex) {
  const body = strip0x(hex);
  assertHex(body, 'RPC result');
  if (body.length < 64) throw new Error('RPC result is shorter than one ABI word.');
  return BigInt(`0x${body.slice(0, 64)}`);
}

export function decodeBoolWord(hex) {
  return decodeUintWord(hex) !== 0n;
}

export function decodeAddressWord(hex) {
  const body = strip0x(hex);
  assertHex(body, 'RPC result');
  if (body.length < 64) throw new Error('RPC result is shorter than one ABI word.');
  return `0x${body.slice(24, 64)}`.toLowerCase();
}

export function maskImmutableReferences(bytecode, immutableReferences = {}) {
  const body = strip0x(bytecode).toLowerCase();
  assertEvenHex(body, 'Runtime bytecode');
  const bytes = body.match(/../g) ?? [];
  for (const refs of Object.values(immutableReferences ?? {})) {
    for (const ref of refs ?? []) {
      const start = Number(ref.start);
      const length = Number(ref.length);
      if (!Number.isInteger(start) || !Number.isInteger(length) || start < 0 || length < 0 || start + length > bytes.length) {
        throw new Error('Compiler immutable reference is outside runtime bytecode bounds.');
      }
      for (let i = start; i < start + length; i += 1) bytes[i] = '00';
    }
  }
  return `0x${bytes.join('')}`;
}

export function runtimeBytecodeMatches(compiledBytecode, liveBytecode, immutableReferences = {}) {
  const compiled = maskImmutableReferences(compiledBytecode, immutableReferences);
  const live = maskImmutableReferences(liveBytecode, immutableReferences);
  return compiled === live;
}
