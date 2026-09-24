import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { evaluateAppReleasePolicy } from '../src/features/app-release/version-policy.ts';

const gate = readFileSync(
  'src/features/app-release/use-app-release-gate.ts',
  'utf8',
);
const root = readFileSync('src/app/_layout.tsx', 'utf8');
const auth = readFileSync('src/features/auth/auth-context.tsx', 'utf8');
const signIn = readFileSync('src/features/auth/sign-in-screen.tsx', 'utf8');

const foregroundHandler = gate.match(
  /AppState\.addEventListener\('change', \(nextState\) => \{([\s\S]*?)\n    \}\);/,
)?.[1];
assert.ok(foregroundHandler, 'Foreground release check is missing');
assert.match(foregroundHandler, /nextState === 'active'/);
assert.match(foregroundHandler, /void recheck\(\)/);
assert.doesNotMatch(foregroundHandler, /setState|status: 'checking'/);
assert.match(gate, /useState<GateState>\(\{ status: 'checking' \}\)/);
assert.match(root, /isRestoring \|\| appRelease\.status === 'checking'/);
assert.match(root, /<Stack[\s\S]*<Stack\.Protected/);
assert.match(signIn, /useForm<SignInValues>\(\{/);
assert.match(signIn, /defaultValues: \{ email: '', password: '' \}/);
assert.doesNotMatch(signIn, /AsyncStorage|SecureStore/);
console.log(
  'PASS: foreground recheck keeps the existing unauthenticated Stack and transient sign-in form mounted.',
);

assert.match(
  auth,
  /supabase\.auth\.onAuthStateChange\(\(event, nextSession\) =>/,
);
assert.match(auth, /setSession\(nextSession\)/);
assert.match(root, /guard=\{Boolean\([\s\S]*?session &&/);
assert.match(root, /guard=\{Boolean\([\s\S]*?!session &&/);
assert.match(gate, /result === 'upgrade' \|\| result === 'maintenance'/);
const release = JSON.parse(readFileSync('app.json', 'utf8')).expo;
assert.equal(
  evaluateAppReleasePolicy(
    {
      platform: 'ios',
      version: release.version,
      build: release.ios.buildNumber,
    },
    {
      platform: 'ios',
      minimum_app_version: '1.1.1',
      minimum_build: 5,
      recommended_app_version: null,
      maintenance_mode: false,
      enforce_mutation_gate: false,
      maintenance_message: null,
      updated_at: '2026-09-24T00:00:00Z',
    },
  ),
  'allowed',
);
console.log(
  'PASS: actual auth session changes still update protected routes; gate results can still block.',
);
