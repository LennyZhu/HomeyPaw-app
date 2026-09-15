import { access, readFile } from 'node:fs/promises';
import ts from 'typescript';

const root = new URL('../', import.meta.url);
const read = (path) => readFile(new URL(path, root), 'utf8');
const failures = [];

function check(value, message) {
  if (!value) failures.push(message);
}

function section(source, start, end) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex);
  return startIndex >= 0 && endIndex > startIndex
    ? source.slice(startIndex, endIndex)
    : '';
}

const [
  capabilities,
  form,
  publishing,
  queries,
  journal,
  detail,
  home,
  viewer,
  pipeline,
  storage,
  tus,
  publishDebug,
  patchScript,
  compressorPatch,
  appLayout,
  postsLayout,
  viewerRoute,
] = await Promise.all([
  read('src/config/capabilities.ts'),
  read('src/features/posts/components/post-form.tsx'),
  read('src/features/posts/post-publishing.ts'),
  read('src/features/posts/post-queries.ts'),
  read('src/features/journal/journal-screen.tsx'),
  read('src/features/posts/post-detail-screen.tsx'),
  read('src/features/home/home-screen.tsx'),
  read('src/features/posts/post-video-viewer-screen.tsx'),
  read('src/features/posts/video/post-video-pipeline.ts'),
  read('src/features/posts/video/post-video-storage.ts'),
  read('src/features/posts/video/post-video-tus.ts'),
  read('src/features/posts/video/post-video-publish-debug.ts'),
  read('scripts/apply-package-patches.mjs'),
  read('patches/react-native-compressor+2.0.3.patch'),
  read('src/app/_layout.tsx'),
  read('src/app/posts/_layout.tsx'),
  read('src/app/posts/[id]/video.tsx'),
]);

check(
  capabilities.includes('journalVideoCreationEnabled') &&
    capabilities.includes('LOCAL_BACKEND') &&
    capabilities.includes('ServerCapabilities'),
  'creation gate must be capability-based, local-safe, and server-ready',
);
check(
  !capabilities.includes('journalVideoCreationEnabled: __DEV__'),
  'creation gate must not be a direct __DEV__ switch',
);
check(
  form.includes('removePhotosFirst') && form.includes('removeBeforePhotos'),
  'composer must block photo/video mixing in both directions',
);
check(
  form.includes('pickJournalVideo') &&
    form.includes('generateJournalVideoThumbnail') &&
    form.includes('removeJournalVideoTempFiles'),
  'composer must select, thumbnail, and clean temporary video files',
);
check(
  publishing.includes("rpc('create_post_v2'") &&
    publishing.includes("rpc('update_post_v2'") &&
    publishing.includes("rpc('create_post'") &&
    publishing.includes("rpc('update_post'"),
  'video v2 and stable photo v1 RPC paths must coexist',
);
check(
  publishing.includes('reconcileVideoCommit') &&
    publishing.includes("reason: 'commit-unknown'") &&
    publishing.includes('cleanupUploadedVideo'),
  'ambiguous result recovery and immediate cleanup must be present',
);
check(
  pipeline.includes('maxDurationMs: 15_000') &&
    pipeline.includes('maxOutputBytes: 25 * 1024 * 1024') &&
    pipeline.includes("metadata.extension.toLowerCase() !== 'mp4'"),
  'formal pipeline must validate duration, size, and MP4 output',
);
const sourceValidation = section(
  pipeline,
  'export function validatePickedJournalVideo',
  'export async function compressJournalVideo',
);
const compressedOutputValidation = section(
  pipeline,
  'export async function compressJournalVideo',
  'export function cancelJournalVideoCompression',
);
check(
  sourceValidation.includes('maxDurationMs') &&
    !sourceValidation.includes('fileSize') &&
    !sourceValidation.includes('maxOutputBytes'),
  'source videos above 25 MiB must remain eligible when duration is valid',
);
check(
  compressedOutputValidation.includes(
    'result.fileSize > journalVideoLimits.maxOutputBytes',
  ) &&
    compressedOutputValidation.includes("'VIDEO_OUTPUT_SIZE_LIMIT_EXCEEDED',"),
  'compressed output above 25 MiB must be rejected before upload',
);
check(
  compressorPatch.includes('exporter.metadata = []') &&
    patchScript.includes("expectedCompressorVersion = '2.0.3'"),
  'version-locked metadata privacy patch must remain enforced',
);
check(
  tus.includes('6 * 1024 * 1024') &&
    tus.includes("request.responseType = 'blob'") &&
    tus.includes('nativeBlob.slice(') &&
    tus.includes("'application/offset+octet-stream'") &&
    tus.includes("'homeypaw-v1'") &&
    tus.includes("'post-videos'") &&
    tus.includes('objectName') &&
    tus.includes('file.size') &&
    tus.includes("'x-upsert': 'false'") &&
    !tus.includes('readAsString') &&
    !/\.arrayBuffer\s*\(/u.test(tus) &&
    !/new\s+Blob\s*\(\s*\[/u.test(tus) &&
    !/\bUint8Array\b/u.test(tus) &&
    !/fetch\s*\(\s*(?:fileUri|input\.uri)/u.test(tus),
  'TUS must use 6 MiB React Native native-Blob slices without ArrayBuffer, base64, fetch(uri).blob(), or upsert',
);
check(
  tus.includes('isDeterministicClientFailure') &&
    tus.includes("'fail_fast'") &&
    tus.includes('defaultOptions.onShouldRetry'),
  'deterministic local Blob/file failures must fail fast while transient failures retain the default retry policy',
);
check(
  storage.includes('postVideoSignedUrlTtlSeconds = 10 * 60') &&
    storage.includes('createPostVideoThumbnailSignedUrls'),
  'video URL TTL must be ten minutes and thumbnails separately signed',
);
check(
  queries.includes("select('*, post_media(*), post_videos(*)')") &&
    queries.includes('normalizePost'),
  'post readers must normalize photo, text-only, and video relations',
);
check(
  journal.includes('PostVideoThumbnail') &&
    journal.includes('router.push(`/posts/${item.post.id}/video`') &&
    !journal.includes('usePostVideoUrl'),
  'Timeline must navigate with post identity and never request video URLs',
);
check(
  viewerRoute.includes('post-video-viewer-screen') &&
    !postsLayout.includes('presentation') &&
    viewer.includes('useLocalSearchParams') &&
    viewer.includes('usePost(id)') &&
    viewer.includes('usePostVideoUrl') &&
    viewer.includes('useVideoPlayer(null') &&
    viewer.includes('.replaceAsync({ uri: signedUrl })') &&
    viewer.includes('nativeControls={false}') &&
    viewer.includes("useEvent(player, 'playingChange'") &&
    viewer.includes("useEventListener(player, 'playToEnd'") &&
    viewer.includes('player.replay()') &&
    viewer.includes("AppState.addEventListener('change'") &&
    viewer.includes('File.downloadFileAsync') &&
    viewer.includes('MediaLibrary.Asset.create'),
  'router viewer must load by post id on demand, use custom controls, replay, and save explicitly',
);
check(
  !viewer.includes('isFetchedAfterMount') &&
    viewer.includes("logViewerError('source_bind_failed'") &&
    viewer.includes('VIDEO_SOURCE_LOAD_TIMEOUT') &&
    viewer.includes('hasSourceBindingError') &&
    viewer.includes('isCurrentSourceReady') &&
    viewer.includes('playerInstanceId'),
  'every Viewer mount must bind cached or fresh URLs to its own player and fail instead of loading forever',
);
check(
  viewer.includes("console.error('[JournalVideo][Viewer]'") &&
    !viewer.includes('console.info') &&
    !viewer.includes('viewer_mount') &&
    !viewer.includes('source_bind_start') &&
    !viewer.includes('first_frame_rendered') &&
    viewer.includes("video: { flex: 1, width: '100%' }") &&
    viewer.includes('styles.playbackControls') &&
    !viewer.includes('StyleSheet.absoluteFill'),
  'viewer must retain actionable errors without temporary lifecycle/render noise, and keep controls outside the video frame',
);
check(
  pipeline.includes('console.error(`[JournalVideo][${stage}] failed`') &&
    !pipeline.includes('console.info') &&
    !pipeline.includes("debugStage('compress', 'progress'") &&
    !tus.includes("logJournalVideoPublish('upload_video', 'progress'") &&
    publishDebug.includes('sanitizeJournalVideoLogText') &&
    publishDebug.includes('x-amz-signature') &&
    publishDebug.includes("console.error('[JournalVideo][Publish][FAILED]'") &&
    viewer.includes('sanitizeJournalVideoLogText'),
  'DEV diagnostics must retain staged errors, remove success/progress noise, and redact credentials and signed URL signatures',
);
check(
  !viewer.includes('Modal') &&
    viewer.includes('router.back()') &&
    detail.includes('router.push(`/posts/${post.id}/video`') &&
    !journal.includes('videoViewer') &&
    !detail.includes('videoViewerVisible'),
  'video viewer must be a normal router screen with router.back and no Modal visibility state',
);
check(
  !viewer.includes('ViewerTouch') &&
    !viewer.includes('Video surface disabled for hit-test A/B') &&
    !appLayout.includes('DevMenuPreferences') &&
    !appLayout.includes('showFloatingActionButton') &&
    !appLayout.includes('touchGestureEnabled'),
  'temporary Viewer touch probes and Dev Menu overrides must be removed',
);
check(
  !viewer.includes('useEffect(() => () => player.pause()') &&
    !viewer.includes('player.release') &&
    !viewer.includes('beforeRemove') &&
    !viewer.includes("addListener('blur'") &&
    viewer.includes('player.pause();\n    if (router.canGoBack())'),
  'useVideoPlayer must own unmount release while Close pauses only before router navigation',
);

const viewerAst = ts.createSourceFile(
  'viewer.tsx',
  viewer,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const jsxElements = [];
function visitViewer(node) {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
    jsxElements.push(node);
  }
  ts.forEachChild(node, visitViewer);
}
visitViewer(viewerAst);
const opening = (node) => node.openingElement ?? node;
const attribute = (node, name) =>
  opening(node)
    .attributes.properties.find(
      (item) => ts.isJsxAttribute(item) && item.name.text === name,
    )
    ?.initializer?.getText(viewerAst);
const region = (style) =>
  jsxElements.find(
    (node) => attribute(node, 'style') === '{styles.' + style + '}',
  );
const toolbar = region('toolbar');
const content = region('content');
const controls = region('playbackControls');
const videoViews = jsxElements.filter(
  (node) => opening(node).tagName.getText(viewerAst) === 'VideoView',
);
check(
  videoViews.length === 1 &&
    attribute(videoViews[0], 'pointerEvents') === '"none"' &&
    attribute(videoViews[0], 'nativeControls') === '{false}',
  'VideoView itself must disable native controls and all hit testing',
);
check(
  toolbar &&
    content &&
    controls &&
    toolbar.parent === content.parent &&
    content.parent === controls.parent &&
    toolbar.getText(viewerAst).includes('onPress={leaveViewer}') &&
    toolbar.getText(viewerAst).includes('saveVideo()') &&
    controls.getText(viewerAst).includes('onPress={togglePlayback}') &&
    !content.getText(viewerAst).includes('<Pressable'),
  'Save/Close, video area, and custom playback controls must be separate sibling regions',
);
check(
  !/enterFullscreen|exitFullscreen|onFullscreen|fullscreenOptions|posts\.video\.fullscreen|fullscreen_/u.test(
    viewer,
  ) &&
    !viewer.includes('expand-outline') &&
    !viewer.includes('zIndex') &&
    !viewer.includes('elevation'),
  'viewer must have no native fullscreen actions, callbacks, logs, button, or stacking workaround',
);
check(
  detail.includes('PostVideoThumbnail') && home.includes('videoThumbnailUrls'),
  'detail and Home previews must recognize video-only posts',
);
check(
  queries.includes('petId, storagePath') ||
    queries.includes('petId,\n    storagePath'),
  'video signed URL query keys must remain pet-scoped for access cleanup',
);
check(
  !appLayout.includes('dev/journal-video-spike'),
  'the spike route must be removed from the production route tree',
);
try {
  await access(new URL('src/app/dev/journal-video-spike.tsx', root));
  failures.push('the spike route file must be deleted');
} catch {}
try {
  await access(
    new URL('src/features/posts/components/post-video-viewer.tsx', root),
  );
  failures.push('the old Modal video viewer component must be deleted');
} catch {}

if (failures.length > 0) {
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exitCode = 1;
} else {
  console.log('PASS: Journal Video V1B client architecture checks.');
}
