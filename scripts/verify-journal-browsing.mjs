import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

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
assert.deepEqual(
  browsing.getRecentJournalDateRange(30, new Date(2026, 8, 9, 23, 30)),
  { startDate: '2026-08-11', endDate: '2026-09-09' },
);
assert.equal(
  browsing.formatCompactJournalDateRange(
    { startDate: '2026-09-01', endDate: '2026-09-10' },
    'en',
  ),
  '9/1–9/10',
);
assert.equal(
  browsing.formatCompactJournalDateRange(
    { startDate: '2026-09-01', endDate: '2026-09-10' },
    'zh-HK',
  ),
  '1/9–10/9',
);
assert.equal(
  browsing.formatAccessibleJournalDateRange(
    { startDate: '2026-09-01', endDate: '2026-09-10' },
    'en',
  ),
  'September 1, 2026 – September 10, 2026',
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
assert.deepEqual(viewerState.getPhotoViewerPageLayout(2, 390), {
  index: 2,
  length: 390,
  offset: 780,
});
assert.equal(viewerState.getPhotoViewerPageOffset(2, 390, 5), 780);
assert.equal(viewerState.getPhotoViewerPageOffset(9, 390, 5), 1_560);
assert.equal(viewerState.getPhotoViewerPageOffset(2, 0, 5), 0);
assert.equal(viewerState.shouldCaptureZoomedPhotoPan(1), false);
assert.equal(viewerState.shouldCaptureZoomedPhotoPan(2.5), true);
assert.equal(viewerState.clampZoomedPhotoOffset(500, 390, 2), 195);
assert.equal(viewerState.clampZoomedPhotoOffset(-500, 390, 2), -195);
assert.equal(viewerState.shouldCaptureZoomedPhotoPan(1), false);
assert.equal(viewerState.getPhotoViewerIndexFromOffset(780, 390, 5), 2);
for (let initialIndex = 0; initialIndex < 9; initialIndex++) {
  assert.equal(
    viewerState.clampPhotoViewerIndex(initialIndex, 9),
    initialIndex,
  );
  for (const width of [390, 844]) {
    const offset = viewerState.getPhotoViewerPageOffset(initialIndex, width, 9);
    assert.equal(
      viewerState.getPhotoViewerIndexFromOffset(offset, width, 9),
      initialIndex,
    );
  }
}
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
assert(journal.includes('ref={listRef}'));
assert(journal.includes('listRef.current?.scrollToOffset'));
assert(!journal.includes('key={listStateKey}'));
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
assert(journal.includes('styles.titleRow'));
assert(journal.includes('styles.filterAction'));
assert(!journal.includes('styles.filterButton'));
assert(!journal.includes('name="calendar-outline"'));
assert(journal.includes('ellipsizeMode="tail"'));
assert(journal.includes('numberOfLines={1}'));
assert(journal.includes('const petId = petsState.currentPetId'));
assert(journal.includes('usePosts(petId, dateRange)'));
assert(journal.includes('usePetPostAuthors(petId)'));
assert(!journal.includes('PetSwitcherModal'));
assert(!journal.includes('setCurrentPetId'));
assert(!journal.includes("router.push('/pets/new')"));
assert(!journal.includes("t('journal.filter.petAccessibility'"));
assert(en.includes('Filter journal by date. Current range: {{range}}'));
assert(zh.includes('按日期篩選日記。目前範圍：{{range}}'));
assert(en.includes('"all": "All"'));
assert(zh.includes('"all": "全部"'));
console.log(
  'PASS: Detail back preserves the mounted list; cached pagination, range query, filtered empty state, and keyed offsets are wired.',
);

assert(viewer.includes('horizontal'));
assert(viewer.includes('pagingEnabled'));
assert(viewer.includes('onLayout={handlePagerLayout}'));
assert(viewer.includes('getPhotoViewerPageLayout(index, pagerViewport.width)'));
assert(viewer.includes('removeClippedSubviews={false}'));
assert(viewer.includes('scrollEnabled={!isCurrentPhotoZoomed}'));
assert(viewer.includes('scheduleOnRN('));
assert(viewer.includes('setIsCurrentPhotoZoomed(false)'));
assert.match(viewer, /index === currentIndex\s*\?\s*setIsCurrentPhotoZoomed/);
assert(viewer.includes('? Gesture.Simultaneous(pinch, zoomedPan, doubleTap)'));
assert(viewer.includes(': Gesture.Simultaneous(pinch, doubleTap)'));
assert(viewer.includes('getCurrentPostPhoto(media, mediaUrls, currentIndex)'));
const indicatorStart = viewer.indexOf(
  '{controlsVisible && media.length > 1 ? (',
);
const indicatorEnd = viewer.indexOf('{saveFeedback ? (', indicatorStart);
assert(indicatorStart >= 0 && indicatorEnd > indicatorStart);
const indicator = viewer.slice(indicatorStart, indicatorEnd);
assert.match(indicator, /media\.map\(\(item, index\) => \(/u);
assert.match(indicator, /key=\{item\.id\}/u);
assert.match(indicator, /index === currentIndex && styles\.activePageDot/u);
assert.match(indicator, /position: currentIndex \+ 1/u);
assert.match(indicator, /total: media\.length/u);
assert.match(
  indicator,
  /accessibilityLabel=\{t\('posts\.photos\.viewerPosition'/u,
);
assert.match(indicator, /accessibilityRole="text"/u);
assert.match(indicator, /pointerEvents="none"/u);
assert.match(indicator, /bottom: insets\.bottom \+ spacing\.xl/u);
assert.doesNotMatch(
  indicator,
  /AppText|Pressable|onPress|ViewerNavigationButton/u,
);
assert.doesNotMatch(
  viewer,
  /ViewerNavigationButton|goToIndex|navigationButton|disabledButton|styles\.controls|chevron-back|chevron-forward|posts\.photos\.(previous|next)/u,
);
assert.match(viewer, /clampPhotoViewerIndex\(initialIndex, media\.length\)/u);
assert.match(viewer, /onMomentumScrollEnd=\{handleScrollEnd\}/u);
assert.match(viewer, /setCurrentIndex\(nextIndex\)/u);
assert.doesNotMatch(viewer, /set(?:Dot|Indicator|Page)Index/u);
const english = JSON.parse(en).posts.photos;
const chinese = JSON.parse(zh).posts.photos;
assert.equal(english.viewerPosition, 'Photo {{position}} of {{total}}');
assert.equal(chinese.viewerPosition, '第 {{position}} 張，共 {{total}} 張');
for (const copy of [english, chinese]) {
  assert.equal('previous' in copy, false);
  assert.equal('next' in copy, false);
}
assert(!viewer.includes('useWindowDimensions'));
assert(!viewer.includes('scrollToIndex'));
assert(!viewer.includes('key={`${item.id}-${width}-${height}'));
assert.match(
  viewer,
  /<View accessibilityViewIsModal style=\{styles.viewer\}>/u,
);
assert.match(viewer, /pages: \{ \.\.\.StyleSheet.absoluteFill \}/u);
assert.match(viewer, /zoomSurface: \{ width: '100%', height: '100%' \}/u);
assert(viewer.includes('contentFit="contain"'));
assert(!viewer.includes('viewportHeight * 0.78'));
for (const style of ['closeButton', 'saveButton', 'pageIndicator']) {
  const overlay = viewer.match(
    new RegExp(`\\n  ${style}: \\{([\\s\\S]*?)\\n  \\},`, 'u'),
  )?.[1];
  assert(overlay?.includes("position: 'absolute'"));
  assert(overlay?.includes('zIndex: 3'));
  assert(overlay?.includes('elevation: 3'));
}
for (const edge of ['top', 'bottom', 'left', 'right']) {
  assert(viewer.includes(`insets.${edge} + spacing.`));
}
console.log(
  'PASS: Photo Viewer uses a full viewport contain canvas with safe-area controls above the pager.',
);
console.log(
  'PASS: Multi-photo dots use the real currentIndex and a safe-area overlay; single-photo indicators, arrows and visible counters are absent; swipe, zoom pan and Save to Photos are retained.',
);

assert.match(
  viewer,
  /\[controlsVisible, setControlsVisible\] = useState\(true\)/u,
);
assert.match(viewer, /\{controlsVisible \? \(\s*<IconButton/u);
assert.match(
  viewer,
  /\{controlsVisible && canSavePostPhotoToLibrary && currentPhoto \? \(/u,
);
assert.match(viewer, /icon="close"\s+onPress=\{onClose\}/u);
assert.match(viewer, /onToggleControls=\{handleToggleControls\}/u);
// Both entry points mount a fresh Viewer session; no page/resize effect resets
// visibility, and only a recognized tap can change it during that session.
assert.match(journal, /\{photoViewer \? \(\s*<PostPhotoViewer/u);
assert.match(detail, /\{viewerIndex !== null \? \(\s*<PostPhotoViewer/u);
assert.equal(viewer.match(/setControlsVisible/gu)?.length, 2);
const photoComponent = viewer.slice(
  viewer.indexOf('function ZoomablePostPhoto'),
);
assert.match(
  photoComponent,
  /<GestureDetector gesture=\{photoGesture\}>\s*<View style=\{\[styles.page, \{ height: viewportHeight, width \}\]\}>/u,
);
assert.doesNotMatch(
  viewer.slice(0, viewer.indexOf('function ZoomablePostPhoto')),
  /<GestureDetector/u,
);
assert.doesNotMatch(photoComponent, /<IconButton|<Pressable/u);

// Run the real callbacks with small Gesture/state mocks; native recognition
// remains covered by the configured Exclusive priority and tap distance limit.
const viewerAst = ts.createSourceFile(
  'post-photo-viewer.tsx',
  viewer,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const declarations = new Map();
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    declarations.set(node.name.text, node.getText(viewerAst));
  }
  ts.forEachChild(node, visit);
};
visit(viewerAst);
const loadDeclarations = (names, result, context) => {
  const source = names.map((name) => {
    assert(declarations.has(name), `Missing Viewer declaration: ${name}`);
    return `const ${declarations.get(name)};`;
  });
  const compiled = ts.transpileModule(source.join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(
    'context',
    `const { ${Object.keys(context).join(', ')} } = context;\n${compiled}\nreturn ${result};`,
  )(context);
};
const mockGesture = (kind) => {
  const gesture = { kind, config: {}, callbacks: {} };
  for (const method of ['numberOfTaps', 'maxDistance']) {
    gesture[method] = (value) => {
      gesture.config[method] = value;
      return gesture;
    };
  }
  for (const method of ['onStart', 'onUpdate', 'onEnd', 'onTouchesDown']) {
    gesture[method] = (callback) => {
      gesture.callbacks[method] = callback;
      return gesture;
    };
  }
  return gesture;
};
const Gesture = {
  Tap: () => mockGesture('tap'),
  Pinch: () => mockGesture('pinch'),
  Pan: () => mockGesture('pan'),
  Simultaneous: (...gestures) => ({ kind: 'simultaneous', gestures }),
  Exclusive: (...gestures) => ({ kind: 'exclusive', gestures }),
};
for (const isZoomed of [false, true]) {
  let controlsVisible = true;
  const toggle = loadDeclarations(
    ['handleToggleControls'],
    'handleToggleControls',
    {
      useCallback: (callback) => callback,
      setControlsVisible: (update) => {
        controlsVisible = update(controlsVisible);
      },
    },
  );
  const context = {
    Gesture,
    isZoomed,
    canShowImage: true,
    onToggleControls: toggle,
    scheduleOnRN: (callback, ...args) => callback(...args),
    reportZoomChange: () => {},
    scale: { value: 1 },
    startScale: { value: 1 },
    translateX: { value: 0 },
    translateY: { value: 0 },
    startTranslateX: { value: 0 },
    startTranslateY: { value: 0 },
    width: 390,
    viewportHeight: 844,
    withTiming: (value) => value,
    clampZoomedPhotoOffset: viewerState.clampZoomedPhotoOffset,
    shouldCaptureZoomedPhotoPan: viewerState.shouldCaptureZoomedPhotoPan,
  };
  const gestureNames = [
    'pinch',
    'zoomedPan',
    'doubleTap',
    'zoomGesture',
    'singleTap',
    'photoGesture',
  ];
  const gestures = loadDeclarations(
    gestureNames,
    `{ ${gestureNames.join(', ')} }`,
    context,
  );
  assert.equal(gestures.photoGesture.kind, 'exclusive');
  assert.deepEqual(gestures.photoGesture.gestures, [
    gestures.zoomGesture,
    gestures.singleTap,
  ]);
  assert.deepEqual(
    gestures.zoomGesture.gestures,
    isZoomed
      ? [gestures.pinch, gestures.zoomedPan, gestures.doubleTap]
      : [gestures.pinch, gestures.doubleTap],
  );
  assert.equal(gestures.doubleTap.config.numberOfTaps, 2);
  assert.equal(gestures.singleTap.config.numberOfTaps, 1);
  assert.equal(gestures.singleTap.config.maxDistance, 8);
  gestures.singleTap.callbacks.onEnd({}, false);
  assert.equal(controlsVisible, true, 'Failed/cancelled taps do not toggle.');
  gestures.singleTap.callbacks.onEnd({}, true);
  assert.equal(controlsVisible, false, 'A recognized tap hides controls.');
  gestures.doubleTap.callbacks.onEnd({}, true);
  assert.equal(context.scale.value, 2.5);
  assert.equal(controlsVisible, false, 'Double tap only zooms.');
  gestures.pinch.callbacks.onStart();
  gestures.pinch.callbacks.onUpdate({ scale: 1.2 });
  gestures.pinch.callbacks.onEnd();
  gestures.zoomedPan.callbacks.onStart();
  gestures.zoomedPan.callbacks.onUpdate({ translationX: 50, translationY: 20 });
  gestures.zoomedPan.callbacks.onEnd();
  assert.equal(controlsVisible, false, 'Pinch/pan never toggle controls.');
  let failures = 0;
  const manager = { fail: () => failures++ };
  gestures.singleTap.callbacks.onTouchesDown({ numberOfTouches: 1 }, manager);
  assert.equal(failures, 0);
  gestures.singleTap.callbacks.onTouchesDown({ numberOfTouches: 2 }, manager);
  assert.equal(failures, 1, 'Multi-finger touches fail the single tap.');

  let pageIndex = 0;
  const handleScrollEnd = loadDeclarations(
    ['handleScrollEnd'],
    'handleScrollEnd',
    {
      getPhotoViewerIndexFromOffset: viewerState.getPhotoViewerIndexFromOffset,
      pagerViewport: { width: 390 },
      media: Array.from({ length: 4 }),
      currentIndexRef: { current: 0 },
      setCurrentIndex: (index) => (pageIndex = index),
      setIsCurrentPhotoZoomed: () => {},
      setSaveFeedback: () => {},
    },
  );
  handleScrollEnd({ nativeEvent: { contentOffset: { x: 780 } } });
  assert.equal(pageIndex, 2);
  assert.equal(controlsVisible, false, 'Swipe preserves hidden controls.');
  gestures.singleTap.callbacks.onEnd({}, true);
  assert.equal(
    controlsVisible,
    true,
    'A second recognized tap restores controls.',
  );
  assert.equal(
    loadDeclarations(gestureNames, 'photoGesture === singleTap', {
      ...context,
      canShowImage: false,
    }),
    true,
    'Loading/error canvas still allows controls to be restored.',
  );
}
console.log(
  'PASS: Controls start visible, hide/restore on recognized single taps, remain hidden after paging, and exclude controls taps; double tap/zoom gestures take priority, multi-touch fails, and loading/error canvas remains tappable.',
);
