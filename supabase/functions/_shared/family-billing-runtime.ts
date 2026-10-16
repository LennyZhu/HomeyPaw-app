import { createClient } from 'npm:@supabase/supabase-js@2.112.3';
import { assertBillingSecrets } from './family-billing-target.mjs';
import {
  assertSandboxTarget,
  createRevenueCatReader,
} from './family-billing-sandbox.mjs';

export function createBillingRuntime() {
  if (Deno.env.get('FAMILY_BILLING_SANDBOX_ENABLED') !== 'true')
    throw new Error('BILLING_SANDBOX_DISABLED');
  // Deliberately no fallback to platform/default/linked Production credentials.
  const url = assertSandboxTarget({
    mode: Deno.env.get('FAMILY_BILLING_TARGET_MODE'),
    projectRef: Deno.env.get('FAMILY_BILLING_SANDBOX_PROJECT_REF'),
    url: Deno.env.get('FAMILY_BILLING_SUPABASE_URL'),
    deploymentId: Deno.env.get('DENO_DEPLOYMENT_ID'),
    serviceKey: Deno.env.get('FAMILY_BILLING_SERVICE_ROLE_KEY'),
    anonKey: Deno.env.get('FAMILY_BILLING_ANON_KEY'),
  });
  assertBillingSecrets({
    webhook: Deno.env.get('REVENUECAT_WEBHOOK_AUTH_SECRET'),
    reconcile: Deno.env.get('FAMILY_BILLING_RECONCILE_SECRET'),
    provider: Deno.env.get('REVENUECAT_SECRET_API_KEY'),
    project: Deno.env.get('REVENUECAT_PROJECT_ID'),
  });
  const admin = createClient(
    url,
    Deno.env.get('FAMILY_BILLING_SERVICE_ROLE_KEY') ?? '',
    {
      auth: { persistSession: false, autoRefreshToken: false },
    },
  );
  const rpc = async (name: string, args: Record<string, unknown> = {}) => {
    const { data, error } = await admin.rpc(name, args);
    if (error) throw new Error(error.message);
    return data;
  };
  const reader = createRevenueCatReader({
    secret: Deno.env.get('REVENUECAT_SECRET_API_KEY'),
    projectId: Deno.env.get('REVENUECAT_PROJECT_ID'),
  });
  return {
    rpc,
    reader,
    url,
    anonKey: Deno.env.get('FAMILY_BILLING_ANON_KEY') ?? '',
  };
}
