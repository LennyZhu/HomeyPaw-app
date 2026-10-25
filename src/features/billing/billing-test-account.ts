import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import { z } from 'zod';

import { fetchWithTimeout } from '@/lib/network-fetch';
import {
  familyPlusSandboxRef,
  isPublicSupabaseKey,
  supabaseEnvironment,
} from '@/lib/supabase/environment';
import type { Database } from '@/types/database';
import { createFamilyBillingClient } from './billing-client';
import {
  familyPlusServerSnapshot,
  parseFamilyPlusSummary,
} from './family-plus-data';

const admissionSchema = z.object({
  user_id: z.uuid(),
  family_id: z.uuid(),
  role: z.enum(['owner', 'member', 'viewer']),
  environment: z.literal('SANDBOX'),
  project_ref: z.literal(familyPlusSandboxRef),
  server_time: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
});
export function parseBillingTestAdmission(data: unknown, userId: string) {
  const result = admissionSchema.parse(data);
  if (
    result.user_id !== userId ||
    Date.parse(result.expires_at) <= Date.parse(result.server_time)
  )
    throw new Error('BILLING_TEST_ACCESS_DENIED');
  return result;
}
function configuration() {
  const key = process.env.EXPO_PUBLIC_SANDBOX_SUPABASE_PUBLISHABLE_KEY;
  const apple = process.env.EXPO_PUBLIC_REVENUECAT_APPLE_KEY;
  if (
    __DEV__ ||
    Platform.OS !== 'ios' ||
    process.env.EXPO_PUBLIC_HOMEYPAW_BUILD_TARGET !== 'production' ||
    process.env.EXPO_PUBLIC_APP_REVIEW_ACCOUNT_ENABLED !== 'true' ||
    supabaseEnvironment.url !== 'https://tknaobmlwmodsqtpqwkr.supabase.co' ||
    !supabaseEnvironment.key ||
    process.env.EXPO_PUBLIC_SANDBOX_SUPABASE_URL !==
      `https://${familyPlusSandboxRef}.supabase.co` ||
    !isPublicSupabaseKey(key, familyPlusSandboxRef) ||
    !apple?.startsWith('appl_')
  )
    return null;
  return {
    url: `https://${familyPlusSandboxRef}.supabase.co`,
    key: key!,
    apple,
  };
}
export const canUseBillingTestAccount = () => Boolean(configuration());

// An independent in-memory Auth/Query/Billing scope, never the app's Production
// client. The public build flag exposes a login form, not a test identity grant.
export async function signInBillingTestAccount(
  email: string,
  password: string,
) {
  const config = configuration();
  if (!config) throw new Error('BILLING_TEST_ACCESS_DENIED');
  const client = createClient<Database>(config.url, config.key, {
    auth: {
      persistSession: false,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: { fetch: fetchWithTimeout },
  });
  let active = true;
  try {
    const login = await client.auth.signInWithPassword({
      email: email.trim().toLowerCase(),
      password,
    });
    if (login.error) throw new Error('BILLING_TEST_ACCESS_DENIED');
    const readAdmission = async () => {
      if (!active) throw new Error('BILLING_TEST_ACCESS_DENIED');
      const { data: verified, error: authError } = await client.auth.getUser();
      if (authError || !verified.user)
        throw new Error('BILLING_TEST_ACCESS_DENIED');
      const { data, error } = await client.rpc(
        'get_family_billing_test_access',
      );
      if (error) throw new Error('BILLING_TEST_ACCESS_DENIED');
      return parseBillingTestAdmission(data, verified.user.id);
    };
    const binding = await readAdmission();
    const authorize = async () => {
      const next = await readAdmission();
      if (
        next.user_id !== binding.user_id ||
        next.family_id !== binding.family_id
      )
        throw new Error('BILLING_TEST_ACCESS_DENIED');
    };
    const billing = createFamilyBillingClient({
      getClient: () => client,
      environment: 'SANDBOX',
      enabled: () => active,
      storeBuild: true,
      applePublicKey: () => config.apple,
      authorize,
    });
    billing.setBillingAuthUser(binding.user_id);
    const { data: subscription } = client.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user.id !== binding.user_id) {
          active = false;
          billing.setBillingAuthUser(null);
        }
      },
    );
    return {
      binding,
      billing,
      async readSummary(signal: AbortSignal) {
        await authorize();
        const { data, error } = await client
          .rpc('get_family_plus_summary', {
            target_family_id: binding.family_id,
          })
          .abortSignal(signal);
        if (error || signal.aborted)
          throw new Error('BILLING_TEST_ACCESS_DENIED');
        const summary = parseFamilyPlusSummary(
          data,
          binding.user_id,
          binding.family_id,
          'SANDBOX',
        );
        return {
          snapshot: familyPlusServerSnapshot(summary),
          role: summary.role,
        };
      },
      async close() {
        active = false;
        billing.setBillingAuthUser(null);
        subscription.subscription.unsubscribe();
        await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
        client.auth.stopAutoRefresh();
      },
    };
  } catch {
    active = false;
    await client.auth.signOut({ scope: 'local' }).catch(() => undefined);
    client.auth.stopAutoRefresh();
    throw new Error('BILLING_TEST_ACCESS_DENIED');
  }
}
export type BillingTestAccount = Awaited<
  ReturnType<typeof signInBillingTestAccount>
>;
