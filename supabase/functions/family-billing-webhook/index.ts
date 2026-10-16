import { createBillingRuntime } from '../_shared/family-billing-runtime.ts';
import {
  createBillingWebhookHandler,
  json,
} from '../_shared/family-billing-sandbox.mjs';

Deno.serve(async (request) => {
  try {
    const runtime = createBillingRuntime();
    return await createBillingWebhookHandler({
      ...runtime,
      webhookSecret: Deno.env.get('REVENUECAT_WEBHOOK_AUTH_SECRET'),
    })(request);
  } catch {
    return json({ error: 'BILLING_SANDBOX_UNAVAILABLE' }, 503);
  }
});
