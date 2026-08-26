const { defineConfig, globalIgnores } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');
const eslintPluginPrettierRecommended = require('eslint-plugin-prettier/recommended');

module.exports = defineConfig([
  globalIgnores(['.expo/*', 'coverage/*', 'dist/*', 'website/**']),
  expoConfig,
  eslintPluginPrettierRecommended,
]);
