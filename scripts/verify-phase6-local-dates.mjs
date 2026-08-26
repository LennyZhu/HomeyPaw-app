import assert from 'node:assert/strict';

function localDate(iso, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    day: '2-digit',
    month: '2-digit',
    timeZone,
    year: 'numeric',
  }).formatToParts(new Date(iso));
  const values = Object.fromEntries(
    parts.map((part) => [part.type, part.value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
}

assert.equal(
  localDate('2026-08-24T00:30:00.000Z', 'Asia/Hong_Kong'),
  '2026-08-24',
);
assert.equal(
  localDate('2026-08-24T00:30:00.000Z', 'America/Los_Angeles'),
  '2026-08-23',
);
assert.equal(
  localDate('2026-12-31T23:30:00.000Z', 'Pacific/Kiritimati'),
  '2027-01-01',
);
assert.equal(
  localDate('2026-01-01T00:30:00.000Z', 'Pacific/Honolulu'),
  '2025-12-31',
);

console.log('PASS: Phase 6 IANA time-zone date boundaries are correct.');
