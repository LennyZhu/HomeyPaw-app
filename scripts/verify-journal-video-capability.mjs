import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Script } from 'node:vm';
import ts from 'typescript';

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const compile = (path) =>
  ts.transpileModule(read(path), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
const backendSource = compile('src/config/backend-target.ts');
const capabilitySource = compile('src/config/capabilities.ts');

function loadCapabilities(dev, url, override) {
  const env = {};
  if (url !== undefined) env.EXPO_PUBLIC_SUPABASE_URL = url;
  if (override !== undefined)
    env.EXPO_PUBLIC_JOURNAL_VIDEO_CREATION_ENABLED = override;
  const backend = { exports: {} };
  new Script(backendSource).runInNewContext({
    exports: backend.exports,
    module: backend,
    process: { env },
    URL,
  });
  const capabilities = { exports: {} };
  new Script(capabilitySource).runInNewContext({
    __DEV__: dev,
    exports: capabilities.exports,
    module: capabilities,
    process: { env },
    require: (name) => {
      assert.equal(name, './backend-target');
      return backend.exports;
    },
  });
  return capabilities.exports;
}

const remote = 'https://fixture.supabase.co';
for (const url of [
  remote,
  'http://localhost:54321',
  'http://127.0.0.1:54321',
  'http://localhost.example.com',
  'invalid-url',
  undefined,
]) {
  for (const override of [undefined, 'false', 'true']) {
    const release = loadCapabilities(false, url, override);
    assert.equal(release.RELEASE_JOURNAL_VIDEO_CREATION_ENABLED, true);
    assert.equal(release.appCapabilities.journalVideoCreationEnabled, true);
    assert.equal(
      release.resolveAppCapabilities().journalVideoCreationEnabled,
      true,
    );
  }
}
for (const url of ['http://localhost:54321', 'http://127.0.0.1:54321']) {
  for (const override of [undefined, 'false', 'true']) {
    assert.equal(
      loadCapabilities(true, url, override).appCapabilities
        .journalVideoCreationEnabled,
      override === 'true',
      'DEV/local retains explicit opt-in',
    );
  }
}
for (const url of [remote, 'http://localhost.example.com', undefined]) {
  assert.equal(
    loadCapabilities(true, url, 'true').appCapabilities
      .journalVideoCreationEnabled,
    false,
    'DEV remote/missing backend cannot use the local override',
  );
}
assert.equal(
  loadCapabilities(true, remote).resolveAppCapabilities({
    journalVideoCreationEnabled: true,
  }).journalVideoCreationEnabled,
  true,
  'the existing reserved server input remains compatible',
);

const form = read('src/features/posts/components/post-form.tsx');
assert.equal(
  (form.match(/appCapabilities\.journalVideoCreationEnabled/g) ?? []).length,
  3,
  'the shared create/edit Composer uses the release capability for all Video actions',
);
for (const screen of ['create-post-screen.tsx', 'edit-post-screen.tsx'])
  assert.ok(read(`src/features/posts/${screen}`).includes('<PostForm'));
for (const path of [
  'src/features/posts/post-publishing.ts',
  'src/features/posts/video/post-video-storage.ts',
  'supabase/migrations/20260914120000_journal_video_backend_foundation.sql',
])
  assert.doesNotMatch(
    read(path),
    /appCapabilities|journalVideoCreationEnabled/u,
  );
assert.doesNotMatch(read('app.json'), /"updates"|"runtimeVersion"/u);

// Exercise the actual validators with in-memory native adapters; no media/IO.
let metadata = {
  duration: 15,
  extension: 'mp4',
  height: 720,
  size: 25 * 1024 * 1024,
  width: 1280,
};
let compressionOptions;
const pipeline = { exports: {} };
new Script(
  compile('src/features/posts/video/post-video-pipeline.ts'),
).runInNewContext({
  __DEV__: false,
  exports: pipeline.exports,
  module: pipeline,
  require: (name) => {
    if (name === 'react-native-compressor')
      return {
        getRealPath: async () => 'fixture-source',
        getVideoMetaData: async () => metadata,
        Video: {
          compress: async (_uri, options) => {
            compressionOptions = options;
            return 'fixture-output';
          },
        },
      };
    if (name === 'expo-file-system')
      return {
        File: class {
          delete() {}
        },
      };
    assert.ok(
      ['expo-image-manipulator', 'expo-image-picker', 'expo-video'].includes(
        name,
      ),
    );
    return {};
  },
});
const picked = { durationMs: 15_000, fileSize: 100 * 1024 * 1024 };
pipeline.exports.validatePickedJournalVideo(picked);
assert.throws(
  () =>
    pipeline.exports.validatePickedJournalVideo({
      ...picked,
      durationMs: 15_001,
    }),
  /VIDEO_DURATION_LIMIT_EXCEEDED/u,
);
const compress = () =>
  pipeline.exports.compressJournalVideo('fixture-source', {
    onCancellationId: () => undefined,
    onProgress: () => undefined,
  });
assert.equal((await compress()).fileSize, 25 * 1024 * 1024);
assert.equal(compressionOptions.maxSize, 1280);
assert.equal(compressionOptions.stripAudio, false);
const validMetadata = metadata;
for (const [invalid, error] of [
  [{ size: 25 * 1024 * 1024 + 1 }, /VIDEO_OUTPUT_SIZE_LIMIT_EXCEEDED/u],
  [{ duration: 15.001 }, /VIDEO_OUTPUT_DURATION_LIMIT_EXCEEDED/u],
  [{ width: 1281 }, /VIDEO_OUTPUT_DIMENSION_LIMIT_EXCEEDED/u],
  [{ extension: 'mov' }, /VIDEO_OUTPUT_NOT_MP4/u],
]) {
  metadata = { ...validMetadata, ...invalid };
  await assert.rejects(compress, error);
}

console.log(
  'PASS: actual release capability enables Video without env/backend-URL dependency; DEV/local opt-in and remote exclusion remain; shared create/edit UI and independent upload/RPC paths are retained. Actual validators keep 15s source duration, large-source eligibility, 25 MiB MP4 output, 1280 dimension and audio preservation.',
);
