import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

process.env.TZ = 'Asia/Hong_Kong';

const read = (path) => readFile(resolve(process.cwd(), path), 'utf8');
const importSource = (path) =>
  import(`${pathToFileURL(resolve(process.cwd(), path)).href}?v=${Date.now()}`);

const browsing = await importSource('src/features/journal/journal-browsing.ts');
const viewerState = await importSource(
  'src/features/posts/photo-viewer-state.ts',
);

assert.deepEqual(
  browsing.toJournalCreatedAtBounds({
    startDate: '2026-09-09',
    endDate: '2026-09-09',
  }),
  {
    startUtc: '2026-09-08T16:00:00.000Z',
    endExclusiveUtc: '2026-09-09T16:00:00.000Z',
  },
);
assert.deepEqual(
  browsing.toJournalCreatedAtBounds({
    startDate: '2026-08-30',
    endDate: '2026-09-02',
  }),
  {
    startUtc: '2026-08-29T16:00:00.000Z',
    endExclusiveUtc: '2026-09-02T16:00:00.000Z',
  },
);
assert.deepEqual(
  browsing.toJournalCreatedAtBounds({
    startDate: '2025-12-31',
    endDate: '2026-01-01',
  }),
  {
    startUtc: '2025-12-30T16:00:00.000Z',
    endExclusiveUtc: '2026-01-01T16:00:00.000Z',
  },
);
assert.equal(browsing.toJournalCreatedAtBounds(undefined), null);
assert.equal(
  browsing.isValidJournalDateRange({
    startDate: '2026-09-10',
    endDate: '2026-09-09',
  }),
  false,
);
assert.deepEqual(
  browsing.getRecentJournalDateRange(7, new Date(2026, 8, 9, 23, 30)),
  { startDate: '2026-09-03', endDate: '2026-09-09' },
);
console.log(
  'PASS: Local same-day, multi-day, month/year boundary, inclusive start, exclusive end, quick range, and clear semantics.',
);

const allKey = browsing.createJournalListStateKey('user-a', 'pet-a');
const filteredKey = browsing.createJournalListStateKey('user-a', 'pet-a', {
  startDate: '2026-09-01',
  endDate: '2026-09-09',
});
assert.notEqual(allKey, filteredKey);
assert.notEqual(
  filteredKey,
  browsing.createJournalListStateKey('user-a', 'pet-b', {
    startDate: '2026-09-01',
    endDate: '2026-09-09',
  }),
);
assert.notEqual(
  filteredKey,
  browsing.createJournalListStateKey('user-b', 'pet-a', {
    startDate: '2026-09-01',
    endDate: '2026-09-09',
  }),
);
assert.equal(browsing.getJournalScrollOffset(filteredKey), 0);
browsing.setJournalScrollOffset(filteredKey, 684.5);
assert.equal(browsing.getJournalScrollOffset(filteredKey), 684.5);
assert.equal(browsing.getJournalScrollOffset(allKey), 0);
console.log('PASS: Scroll state keys isolate user, pet, and date filter.');

assert.equal(viewerState.getPhotoViewerIndexFromOffset(0, 390, 5), 0);
assert.equal(viewerState.getPhotoViewerIndexFromOffset(410, 390, 5), 1);
assert.equal(viewerState.getPhotoViewerIndexFromOffset(1_950, 390, 5), 4);
assert.equal(viewerState.shouldCaptureZoomedPhotoPan(1), false);
assert.equal(viewerState.shouldCaptureZoomedPhotoPan(2.5), true);
assert.equal(viewerState.clampZoomedPhotoOffset(500, 390, 2), 195);
assert.equal(viewerState.clampZoomedPhotoOffset(-500, 390, 2), -195);
assert.equal(viewerState.shouldCaptureZoomedPhotoPan(1), false);
assert.equal(viewerState.getPhotoViewerIndexFromOffset(780, 390, 5), 2);
console.log(
  'PASS: Swipe index boundaries and zoom/restored-zoom gesture ownership.',
);

const [journal, store, query, detail, modal, viewer, en, zh] =
  await Promise.all([
    read('src/features/journal/journal-screen.tsx'),
    read('src/features/journal/journal-browsing.ts'),
    read('src/features/posts/post-queries.ts'),
    read('src/features/posts/post-detail-screen.tsx'),
    read('src/features/journal/components/journal-date-filter-modal.tsx'),
    read('src/features/posts/components/post-photo-viewer.tsx'),
    read('src/i18n/locales/en.json'),
    read('src/i18n/locales/zh-HK.json'),
  ]);

assert(detail.includes('router.canGoBack()'));
assert(detail.includes('router.back()'));
assert(journal.includes('contentOffset={{ x: 0, y: initialScrollOffset }}'));
assert(journal.includes('key={listStateKey}'));
assert(journal.includes('maintainVisibleContentPosition'));
assert(journal.includes('setJournalScrollOffset'));
assert(store.includes('journalScrollOffsets'));
assert(query.includes('queryKey: postKeys.list(user?.id, petId, dateRange)'));
assert(query.includes(".gte('created_at', createdAtBounds.startUtc)"));
assert(query.includes(".lt('created_at', createdAtBounds.endExclusiveUtc)"));
assert(query.includes('postKeys.listRoot(user?.id, post.pet_id)'));
assert(modal.includes('applyPreset(7)'));
assert(modal.includes('applyPreset(30)'));
assert(modal.includes('<JournalDateField'));
assert(journal.includes("t('journal.filter.emptyTitle')"));
assert(en.includes('Filter journal by date. Current range: {{range}}'));
assert(zh.includes('按日期篩選日記。目前範圍：{{range}}'));
console.log(
  'PASS: Detail back preserves the mounted list; cached pagination, range query, filtered empty state, and keyed offsets are wired.',
);

assert(viewer.includes('horizontal'));
assert(viewer.includes('pagingEnabled'));
assert(viewer.includes('scrollEnabled={!isCurrentPhotoZoomed}'));
assert(viewer.includes('scheduleOnRN('));
assert(viewer.includes('setIsCurrentPhotoZoomed(false)'));
assert(viewer.includes('index === currentIndex ? setIsCurrentPhotoZoomed'));
assert(viewer.includes('? Gesture.Simultaneous(pinch, zoomedPan, doubleTap)'));
assert(viewer.includes(': Gesture.Simultaneous(pinch, doubleTap)'));
assert(viewer.includes('getCurrentPostPhoto(media, mediaUrls, currentIndex)'));
assert(viewer.includes("t('posts.photos.previous')"));
assert(viewer.includes("t('posts.photos.next')"));
console.log(
  'PASS: Viewer keeps buttons and synchronizes swipe, page indicator, zoom pan, and Save to Photos through currentIndex.',
);
