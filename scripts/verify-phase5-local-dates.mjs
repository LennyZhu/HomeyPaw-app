process.env.TZ = 'Asia/Hong_Kong';

const { getRelativeDateKind } =
  await import('../src/features/posts/post-date-label.ts');

const cases = [
  {
    current: '2026-08-23T23:30:00+08:00',
    expectations: [
      ['2026-08-23', 'today'],
      ['2026-08-22', 'yesterday'],
      ['2026-08-21', 'date'],
    ],
  },
  {
    current: '2026-08-24T00:10:00+08:00',
    expectations: [
      ['2026-08-24', 'today'],
      ['2026-08-23', 'yesterday'],
      ['2026-08-22', 'date'],
    ],
  },
  {
    current: '2026-08-24T01:00:00+08:00',
    expectations: [
      ['2026-08-24', 'today'],
      ['2026-08-23', 'yesterday'],
      ['2026-08-22', 'date'],
    ],
  },
];

for (const testCase of cases) {
  const current = new Date(testCase.current);
  for (const [dateOnly, expected] of testCase.expectations) {
    const actual = getRelativeDateKind(dateOnly, current);
    if (actual !== expected) {
      throw new Error(
        `${testCase.current}: expected ${dateOnly} to be ${expected}, received ${actual}.`,
      );
    }
  }
}

console.log('PASS: Hong Kong local date labels are correct at 23:30.');
console.log('PASS: Hong Kong local date labels are correct at 00:10.');
console.log('PASS: Hong Kong local date labels are correct at 01:00.');
