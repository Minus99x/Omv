export function cardanoPositiveSafeInteger(value, label) {
  let normalized;
  if (typeof value === 'number' && Number.isSafeInteger(value)) {
    normalized = value;
  } else if (typeof value === 'string' && /^(?:0|[1-9]\d*)$/.test(value)) {
    normalized = Number(value);
  } else if (typeof value === 'bigint' &&
      value <= BigInt(Number.MAX_SAFE_INTEGER) &&
      value >= BigInt(Number.MIN_SAFE_INTEGER)) {
    normalized = Number(value);
  } else {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }

  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw new TypeError(`${label} must be a positive safe integer.`);
  }
  return normalized;
}
