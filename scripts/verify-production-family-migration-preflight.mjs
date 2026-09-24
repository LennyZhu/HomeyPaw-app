import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The fixture oracle operates only on in-memory legacy rows. Production
// topology is read exclusively by docs/sql/multi-pet-production-preflight.sql.
function classify(
  pets,
  members,
  { missingPet = false, missingUser = false } = {},
) {
  const petIds = [...pets].sort();
  const byPet = new Map(petIds.map((id) => [id, []]));
  for (const row of members) {
    if (!byPet.has(row.pet)) continue;
    byPet.get(row.pet).push(row);
  }
  const seen = new Set();
  const results = [];
  for (const seed of petIds) {
    if (seen.has(seed)) continue;
    const queue = [seed];
    const componentPets = new Set();
    while (queue.length) {
      const pet = queue.shift();
      if (componentPets.has(pet)) continue;
      componentPets.add(pet);
      const users = new Set(byPet.get(pet).map(({ user }) => user));
      for (const [other, rows] of byPet) {
        if (
          !componentPets.has(other) &&
          rows.some(({ user }) => users.has(user))
        )
          queue.push(other);
      }
    }
    for (const id of componentPets) seen.add(id);
    const orderedPets = [...componentPets].sort();
    const rows = orderedPets.flatMap((pet) => byPet.get(pet));
    const users = [...new Set(rows.map(({ user }) => user))].sort();
    const signatures = orderedPets.map((pet) =>
      byPet
        .get(pet)
        .map(({ user, role }) => `${user}:${role}`)
        .sort()
        .join(','),
    );
    const ownerIds = new Set(
      rows.filter(({ role }) => role === 'owner').map(({ user }) => user),
    );
    const invalid =
      missingPet ||
      missingUser ||
      orderedPets.some(
        (pet) =>
          byPet.get(pet).filter(({ role }) => role === 'owner').length !== 1,
      );
    const roleMismatch = users.some(
      (user) =>
        new Set(rows.filter((row) => row.user === user).map((row) => row.role))
          .size > 1,
    );
    const before = new Set(rows.map(({ user, pet }) => `${user}:${pet}`));
    const after = new Set(
      users.flatMap((user) => orderedPets.map((pet) => `${user}:${pet}`)),
    );
    const gained = [...after].filter((pair) => !before.has(pair));
    const lost = [...before].filter((pair) => !after.has(pair));
    const classification = invalid
      ? 'INVALID_LEGACY_DATA'
      : orderedPets.length === 1
        ? 'SAFE_SINGLE_PET'
        : ownerIds.size !== 1
          ? 'UNSAFE_OWNER_MISMATCH'
          : roleMismatch
            ? 'UNSAFE_ROLE_MISMATCH'
            : new Set(signatures).size !== 1
              ? 'UNSAFE_DIFFERENT_MEMBERSHIP'
              : gained.length || lost.length
                ? 'UNSAFE_ACCESS_DELTA'
                : 'SAFE_IDENTICAL_MULTI_PET';
    results.push({
      component: orderedPets[0],
      pets: orderedPets,
      users,
      signatures,
      gained: gained.sort(),
      lost: lost.sort(),
      classification,
    });
  }
  return results.sort((a, b) => a.component.localeCompare(b.component));
}

const fixtures = [
  ['A single Pet', ['a'], [['a', 'u1', 'owner']], 'SAFE_SINGLE_PET', 0],
  [
    'B identical',
    ['a', 'b'],
    [
      ['a', 'u1', 'owner'],
      ['a', 'u2', 'member'],
      ['b', 'u1', 'owner'],
      ['b', 'u2', 'member'],
    ],
    'SAFE_IDENTICAL_MULTI_PET',
    0,
  ],
  [
    'C different members',
    ['a', 'b'],
    [
      ['a', 'u1', 'owner'],
      ['a', 'u2', 'member'],
      ['b', 'u1', 'owner'],
      ['b', 'u3', 'member'],
    ],
    'UNSAFE_DIFFERENT_MEMBERSHIP',
    2,
  ],
  [
    'D role mismatch',
    ['a', 'b'],
    [
      ['a', 'u1', 'owner'],
      ['a', 'u2', 'member'],
      ['b', 'u1', 'owner'],
      ['b', 'u2', 'viewer'],
    ],
    'UNSAFE_ROLE_MISMATCH',
    0,
  ],
  [
    'E owner mismatch',
    ['a', 'b'],
    [
      ['a', 'u1', 'owner'],
      ['a', 'u2', 'member'],
      ['b', 'u1', 'member'],
      ['b', 'u2', 'owner'],
    ],
    'UNSAFE_OWNER_MISMATCH',
    0,
  ],
  [
    'F overlapping graph',
    ['a', 'b'],
    [
      ['a', 'u1', 'owner'],
      ['a', 'u2', 'member'],
      ['b', 'u2', 'member'],
      ['b', 'u3', 'owner'],
    ],
    'UNSAFE_OWNER_MISMATCH',
    2,
  ],
  ['G zero Owner', ['a'], [['a', 'u1', 'member']], 'INVALID_LEGACY_DATA', 0],
  [
    'H multiple Owners',
    ['a'],
    [
      ['a', 'u1', 'owner'],
      ['a', 'u2', 'owner'],
    ],
    'INVALID_LEGACY_DATA',
    0,
  ],
  [
    'I orphan membership',
    ['a'],
    [
      ['a', 'u1', 'owner'],
      ['missing', 'u2', 'member'],
    ],
    'INVALID_LEGACY_DATA',
    0,
    { missingPet: true },
  ],
  [
    'J missing Auth user',
    ['a'],
    [['a', 'u1', 'owner']],
    'INVALID_LEGACY_DATA',
    0,
    { missingUser: true },
  ],
];

for (const [name, pets, tuples, expected, expectedGained, flags] of fixtures) {
  const rows = tuples.map(([pet, user, role]) => ({ pet, user, role }));
  const first = classify(pets, rows, flags);
  assert.equal(first.length, 1, name);
  assert.equal(first[0].classification, expected, name);
  assert.equal(first[0].gained.length, expectedGained, name);
  assert.equal(first[0].lost.length, 0, name);
  assert.deepEqual(
    first,
    classify([...pets].reverse(), [...rows].reverse(), flags),
  );
  if (expected.startsWith('SAFE_'))
    assert.deepEqual(first[0].gained, [], `${name}: no access expansion`);
  console.log(`PASS: ${name} -> ${expected}`);
}

const sql = readFileSync('docs/sql/multi-pet-production-preflight.sql', 'utf8');
assert.match(sql, /begin transaction read only;/i);
assert.match(sql, /with recursive/i);
assert.match(sql, /string_agg\(.*role::text/s);
assert.match(sql, /after_access except select \* from before_access/i);
assert.match(sql, /rollback;/i);
assert.doesNotMatch(
  sql.replaceAll(/--[^\n]*/g, ''),
  /\b(create|insert|update|delete|alter|drop|truncate|call|do)\b\s/i,
);
console.log('PASS: read-only SQL structure and deterministic fixtures');
