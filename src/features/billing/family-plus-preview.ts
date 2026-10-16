import type {
  FamilyPlusAction,
  FamilyPlusRole,
  FamilyPlusSnapshot,
  FamilyPlusStatus,
} from './family-plus-presentation';

export const familyPlusPreviewScenes = [
  'free',
  'active',
  'grace',
  'cancelled',
  'expired',
  'revoked',
  'unavailable',
  'transition',
  'loading',
  'empty',
  'error',
  'offline',
] as const;
export type FamilyPlusPreviewScene = (typeof familyPlusPreviewScenes)[number];

export function canUseFamilyPlusPreview(
  development: boolean,
  supabaseUrl: string | undefined,
) {
  if (!development || !supabaseUrl) return false;
  try {
    const url = new URL(supabaseUrl);
    return (
      url.protocol === 'http:' &&
      ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    );
  } catch {
    return false;
  }
}

export function familyPlusPreviewSnapshot(
  development: boolean,
  scene: FamilyPlusPreviewScene,
): FamilyPlusSnapshot {
  if (!development) throw new Error('FAMILY_PLUS_PREVIEW_DISABLED');
  const missing = [
    'loading',
    'empty',
    'error',
    'offline',
    'unavailable',
  ].includes(scene);
  const status: FamilyPlusStatus = missing
    ? 'unavailable'
    : (scene as FamilyPlusStatus);
  const plus = ['active', 'grace', 'cancelled'].includes(status);
  return {
    source: 'development-preview',
    status,
    plusAccess: {
      source: 'development-example',
      givesAccess: plus,
      // No invented expiry date is shown or passed off as provider evidence.
      validUntil: null,
    },
    storage: missing
      ? null
      : {
          usedBytes: (scene === 'expired' ? 480 : 87.4) * 1024 ** 2,
          limitBytes: plus
            ? 5 * 1024 ** 3
            : scene === 'transition'
              ? 1024 ** 3
              : 300 * 1024 ** 2,
        },
    videos: missing
      ? null
      : { uploaded: 2, limit: plus || scene === 'transition' ? null : 3 },
    prices: [
      {
        period: 'monthly',
        priceString: 'US$3.99',
        source: 'development-reference',
      },
      {
        period: 'yearly',
        priceString: 'US$29.99',
        source: 'development-reference',
      },
    ],
  };
}

type PreviewScope = {
  enabled: boolean;
  userId: string | null;
  familyId: string | null;
};
type PreviewMemory = {
  scope: string | null;
  scene: FamilyPlusPreviewScene;
  generation: number;
  mode: 'preview' | 'server';
};
const scopeKey = (scope: PreviewScope) =>
  scope.enabled && scope.userId && scope.familyId
    ? JSON.stringify([scope.userId, scope.familyId])
    : null;

// One disposable display scenario, never a persisted entitlement/cache of paid
// Families. Scope changes discard it, including A -> B -> A and same-user logout.
export function createFamilyPlusPreviewMemory() {
  let state: PreviewMemory = {
    scope: null,
    scene: 'unavailable',
    generation: 0,
    mode: 'preview',
  };
  const listeners = new Set<() => void>();
  const emit = () => listeners.forEach((listener) => listener());
  return {
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    synchronize(scope: PreviewScope) {
      const key = scopeKey(scope);
      if (state.scope === key) return;
      state = {
        scope: key,
        scene: 'unavailable',
        generation: state.generation + 1,
        mode: 'preview',
      };
      emit();
    },
    read(scope: PreviewScope) {
      return scopeKey(scope) !== null && scopeKey(scope) === state.scope
        ? state.scene
        : ('unavailable' as const);
    },
    readMode(scope: PreviewScope) {
      return scopeKey(scope) !== null && scopeKey(scope) === state.scope
        ? state.mode
        : 'preview';
    },
    selectServer(scope: PreviewScope, generation: number) {
      if (
        !scopeKey(scope) ||
        scopeKey(scope) !== state.scope ||
        generation !== state.generation
      )
        return false;
      state = {
        ...state,
        mode: 'server',
        scene: 'unavailable',
        generation: state.generation + 1,
      };
      emit();
      return true;
    },
    select(
      scope: PreviewScope,
      scene: FamilyPlusPreviewScene,
      generation: number,
    ) {
      if (
        !scopeKey(scope) ||
        scopeKey(scope) !== state.scope ||
        generation !== state.generation ||
        !familyPlusPreviewScenes.includes(scene)
      )
        return false;
      if (state.scene !== scene || state.mode !== 'preview') {
        state = { ...state, scene, mode: 'preview' };
        emit();
      }
      return true;
    },
    clear() {
      state = {
        scope: null,
        scene: 'unavailable',
        generation: state.generation + 1,
        mode: 'preview',
      };
      emit();
    },
  };
}

export const familyPlusPreviewMemory = createFamilyPlusPreviewMemory();

// This is deliberately synchronous and has no SDK, network or persistence
// dependency. It can never return a purchase/restore success result.
export function familyPlusPreviewAction(
  development: boolean,
  role: FamilyPlusRole,
  _action: FamilyPlusAction,
): 'previewOnly' | 'ownerOnly' | 'disabled' {
  if (!development) return 'disabled';
  return role === 'owner' ? 'previewOnly' : 'ownerOnly';
}
