import { readdirSync, readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

function flattenKeys(value, prefix = '') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return [prefix];
  }

  return Object.entries(value).flatMap(([key, child]) =>
    flattenKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

function readLocale(name) {
  return JSON.parse(
    readFileSync(new URL(`../src/i18n/locales/${name}.json`, import.meta.url)),
  );
}

const zhKeys = new Set(flattenKeys(readLocale('zh-HK')));
const enKeys = new Set(flattenKeys(readLocale('en')));
const missingInEnglish = [...zhKeys].filter((key) => !enKeys.has(key));
const missingInChinese = [...enKeys].filter((key) => !zhKeys.has(key));

function listSourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return listSourceFiles(path);
    return ['.ts', '.tsx'].includes(extname(entry.name)) ? [path] : [];
  });
}

const sourceKeys = new Set();
const literalTranslationPattern = /\b(?:t|i18n\.t)\(\s*['"]([^'"]+)['"]/gu;
const sourceRoot = fileURLToPath(new URL('../src', import.meta.url));
for (const path of listSourceFiles(sourceRoot)) {
  const source = readFileSync(path, 'utf8');
  for (const match of source.matchAll(literalTranslationPattern)) {
    sourceKeys.add(match[1]);
  }
}
const missingLiteralKeys = [...sourceKeys].filter(
  (key) =>
    !zhKeys.has(key) &&
    !(zhKeys.has(`${key}_one`) && zhKeys.has(`${key}_other`)),
);

if (
  missingInEnglish.length ||
  missingInChinese.length ||
  missingLiteralKeys.length
) {
  console.error('Locale key parity failed.');
  console.error({ missingInChinese, missingInEnglish, missingLiteralKeys });
  process.exitCode = 1;
} else {
  console.log('PASS: zh-HK and en locale keys are in parity.');
}
