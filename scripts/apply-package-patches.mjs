import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';

const require = createRequire(import.meta.url);
const expectedCompressorVersion = '2.0.3';
const compressorPackagePath =
  require.resolve('react-native-compressor/package.json');
const compressorPackage = JSON.parse(
  await readFile(compressorPackagePath, 'utf8'),
);

if (compressorPackage.version !== expectedCompressorVersion) {
  throw new Error(
    `Refusing to apply the HomeyPaw metadata privacy patch: expected ` +
      `react-native-compressor@${expectedCompressorVersion}, found ` +
      `react-native-compressor@${compressorPackage.version}. Regenerate and review the patch ` +
      `before changing this dependency.`,
  );
}

const patchPackagePath = require.resolve('patch-package');
const result = spawnSync(
  process.execPath,
  [patchPackagePath, '--error-on-fail'],
  {
    stdio: 'inherit',
  },
);

if (result.error) {
  throw result.error;
}

if (result.status !== 0) {
  process.exit(result.status ?? 1);
}
