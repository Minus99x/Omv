export function parseBitcoinIsoTimestamp(value, label) {
  const text = typeof value === 'string' ? value : '';
  const invalid = () => new TypeError(`${label} must be a valid ISO-8601 timestamp with a real calendar date and timezone.`);
  const parts = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|([+-])(\d{2}):(\d{2}))$/.exec(text);
  if (!parts) throw invalid();
  const [, yearText, monthText, dayText, hourText, minuteText, secondText,
    fraction = '', , offsetSign, offsetHourText, offsetMinuteText] = parts;
  const [year, month, day, hour, minute, second] = [
    yearText, monthText, dayText, hourText, minuteText, secondText
  ].map(Number);
  const milliseconds = Number(fraction.padEnd(3, '0').slice(0, 3));
  const offsetHours = Number(offsetHourText ?? 0);
  const offsetMinutes = Number(offsetMinuteText ?? 0);
  if (offsetHours > 23 || offsetMinutes > 59) throw invalid();
  const calendar = new Date(0);
  calendar.setUTCFullYear(year, month - 1, day);
  calendar.setUTCHours(hour, minute, second, milliseconds);
  if (!Number.isFinite(calendar.getTime()) ||
      calendar.getUTCFullYear() !== year || calendar.getUTCMonth() !== month - 1 ||
      calendar.getUTCDate() !== day || calendar.getUTCHours() !== hour ||
      calendar.getUTCMinutes() !== minute || calendar.getUTCSeconds() !== second) {
    throw invalid();
  }
  const offset = (offsetSign === '-' ? -1 : 1) * (offsetHours * 60 + offsetMinutes) * 60000;
  const epochMilliseconds = calendar.getTime() - offset;
  if (Date.parse(text) !== epochMilliseconds) throw invalid();
  const fractionNanoseconds = BigInt(fraction.padEnd(9, '0') || '0');
  const millisecondNanoseconds = BigInt(milliseconds) * 1_000_000n;
  return Object.freeze({
    text,
    epochNanoseconds: BigInt(epochMilliseconds) * 1_000_000n +
      fractionNanoseconds - millisecondNanoseconds
  });
}
