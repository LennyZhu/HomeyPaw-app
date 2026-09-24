import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { useCurrentFamily } from './use-current-family';
import type { BackendCapability } from './backend-capability';

export function FamilyContextCoordinator() {
  const context = useCurrentFamily();
  const queryClient = useQueryClient();
  const previousCapability = useRef<BackendCapability | undefined>(undefined);

  useEffect(() => {
    const capability = context.backendCapability;
    if (!capability) return;
    if (
      previousCapability.current &&
      previousCapability.current !== capability
    ) {
      // The old Pet rows have no family_id and Pet-scoped member/invite cache
      // entries cannot be reused after the schema changes underneath this app.
      void queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] !== 'backend-capability',
      });
    }
    previousCapability.current = capability;
  }, [context.backendCapability, queryClient]);

  return null;
}
