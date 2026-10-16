import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { createBillingRuntime } from '../_shared/family-billing-runtime.ts';
import {
  authorizationMatches,
  json,
  reconcileCustomer,
  preflightFamilyPurchase,
  runBillingRecovery,
} from '../_shared/family-billing-sandbox.mjs';

Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
  try {
    const runtime = createBillingRuntime();
    // Optional future recovery scheduler uses a separate internal secret. No
    // scheduler is created/deployed by this prototype.
    if (
      await authorizationMatches(
        request.headers.get('Authorization'),
        Deno.env.get('FAMILY_BILLING_RECONCILE_SECRET'),
      )
    ) {
      const result = await runBillingRecovery(runtime);
      return json(result, result.failed || result.review ? 503 : 200);
    }
    const authorization = request.headers.get('Authorization');
    if (!authorization?.startsWith('Bearer '))
      return json({ error: 'UNAUTHORIZED' }, 401);
    const userClient = createClient(runtime.url, runtime.anonKey, {
      global: {
        headers: {
          Authorization: authorization,
          'x-homeypaw-platform':
            request.headers.get('x-homeypaw-platform') ?? '',
          'x-homeypaw-app-version':
            request.headers.get('x-homeypaw-app-version') ?? '',
          'x-homeypaw-build': request.headers.get('x-homeypaw-build') ?? '',
        },
      },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: user, error: authError } = await userClient.auth.getUser(
      authorization.slice(7),
    );
    if (authError || !user.user) return json({ error: 'UNAUTHORIZED' }, 401);
    // Only operation is accepted. Customer/Family/transaction identifiers are
    // never accepted as claims; the server derives the current Owner's Family.
    const { data: customerId, error } = await userClient.rpc(
      'get_family_billing_customer',
    );
    if (error) return json({ error: 'BILLING_CUSTOMER_UNAVAILABLE' }, 403);
    const body = await request.json().catch(() => ({}));
    if (body?.operation === 'purchase_preflight')
      return json(await preflightFamilyPurchase(runtime, user.user.id));
    return json(await reconcileCustomer(runtime, customerId));
  } catch {
    return json({ error: 'BILLING_VERIFICATION_PENDING' }, 503);
  }
});
