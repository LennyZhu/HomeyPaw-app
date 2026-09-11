import { createClient } from 'npm:@supabase/supabase-js@2';

import {
  buildFamilyPushMessage,
  classifyExpoReceipt,
  classifyExpoTicket,
  isTrustedServiceAuthorization,
  type ExpoPushMessage,
  type FamilyNotificationEvent,
  type FamilyPushTarget,
} from './push-core.ts';

const expoSendUrl = 'https://exp.host/--/api/v2/push/send';
const expoReceiptsUrl = 'https://exp.host/--/api/v2/push/getReceipts';
const requestTimeoutMs = 10_000;

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    status,
  });
}

function readDefaultKey(currentName: string, legacyName: string) {
  const serializedKeys = Deno.env.get(currentName);
  if (serializedKeys) {
    try {
      const defaultKey = (JSON.parse(serializedKeys) as { default?: unknown })
        .default;
      if (typeof defaultKey === 'string' && defaultKey) return defaultKey;
    } catch {
      // Fall through to the legacy local/hosted secret.
    }
  }
  return Deno.env.get(legacyName);
}

function expoHeaders() {
  const accessToken = Deno.env.get('EXPO_ACCESS_TOKEN');
  return {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
  };
}

function isLocalSupabase(url: string) {
  const hostname = new URL(url).hostname;
  return (
    hostname === '127.0.0.1' || hostname === 'localhost' || hostname === 'kong'
  );
}

function mockTicket(message: ExpoPushMessage, deliveryId: string) {
  if (message.to.includes('ticket-device-not-registered')) {
    return {
      status: 'error',
      message: 'Device is no longer registered',
      details: { error: 'DeviceNotRegistered' },
    };
  }
  if (message.to.includes('temporary-error')) {
    return {
      status: 'error',
      message: 'Rate limited',
      details: { error: 'MessageRateExceeded' },
    };
  }
  if (message.to.includes('malformed')) return null;
  if (message.to.includes('network-timeout')) {
    throw new Error('Mock network timeout');
  }
  return {
    status: 'ok',
    id: message.to.includes('receipt-device-not-registered')
      ? `mock-receipt-dnr-${deliveryId}`
      : `mock-ok-${deliveryId}`,
  };
}

async function sendPush(
  message: ExpoPushMessage,
  deliveryId: string,
  useMock: boolean,
) {
  if (useMock) return mockTicket(message, deliveryId);
  const response = await fetch(expoSendUrl, {
    body: JSON.stringify(message),
    headers: expoHeaders(),
    method: 'POST',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Expo push HTTP ${response.status}`);
  }
  const body = (await response.json()) as { data?: unknown };
  return Array.isArray(body.data) ? body.data[0] : body.data;
}

async function getReceipts(ticketIds: string[], useMock: boolean) {
  if (useMock) {
    return Object.fromEntries(
      ticketIds.map((ticketId) => [
        ticketId,
        ticketId.startsWith('mock-receipt-dnr-')
          ? {
              status: 'error',
              message: 'Device is no longer registered',
              details: { error: 'DeviceNotRegistered' },
            }
          : { status: 'ok' },
      ]),
    );
  }
  const response = await fetch(expoReceiptsUrl, {
    body: JSON.stringify({ ids: ticketIds }),
    headers: expoHeaders(),
    method: 'POST',
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Expo receipts HTTP ${response.status}`);
  }
  const body = (await response.json()) as {
    data?: Record<string, unknown>;
  };
  return body.data ?? {};
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed' }, 405);
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = readDefaultKey(
    'SUPABASE_SECRET_KEYS',
    'SUPABASE_SERVICE_ROLE_KEY',
  );
  if (!supabaseUrl || !serviceRoleKey) {
    console.error('Family push server configuration is unavailable.');
    return jsonResponse({ error: 'Server configuration error' }, 500);
  }
  if (
    !isTrustedServiceAuthorization(
      request.headers.get('Authorization'),
      serviceRoleKey,
    )
  ) {
    return jsonResponse({ error: 'Forbidden' }, 403);
  }

  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const useMock =
    Deno.env.get('FAMILY_PUSH_TRANSPORT') === 'mock' ||
    isLocalSupabase(supabaseUrl);
  let requestedEvents = 10;
  try {
    const body = (await request.json()) as { maxEvents?: unknown };
    if (typeof body.maxEvents === 'number') {
      requestedEvents = Math.max(1, Math.min(Math.floor(body.maxEvents), 25));
    }
  } catch {
    // Empty bodies use the bounded default.
  }

  let receiptsProcessed = 0;
  const receipts = await admin.rpc('claim_family_push_receipts', {
    requested_limit: 100,
  });
  if (receipts.error) {
    console.error('Family push receipt claim failed.', {
      code: receipts.error.code,
    });
    return jsonResponse({ error: 'Receipt claim failed' }, 500);
  }
  const receiptRows = (receipts.data ?? []) as {
    delivery_id: string;
    expo_ticket_id: string;
  }[];
  if (receiptRows.length > 0) {
    try {
      const values = await getReceipts(
        receiptRows.map((row) => row.expo_ticket_id),
        useMock,
      );
      for (const row of receiptRows) {
        const result = classifyExpoReceipt(values[row.expo_ticket_id]);
        await admin.rpc('record_family_push_receipt', {
          receipt_error: 'error' in result ? result.error : null,
          receipt_outcome: result.outcome,
          target_delivery_id: row.delivery_id,
        });
        receiptsProcessed += 1;
      }
    } catch (error) {
      for (const row of receiptRows) {
        await admin.rpc('record_family_push_receipt', {
          receipt_error: 'Receipt transport unavailable',
          receipt_outcome: 'pending',
          target_delivery_id: row.delivery_id,
        });
      }
      console.error('Family push receipt transport failed.', {
        name: error instanceof Error ? error.name : 'UnknownError',
      });
    }
  }

  let eventsProcessed = 0;
  let deliveriesProcessed = 0;
  for (let index = 0; index < requestedEvents; index += 1) {
    const claimed = await admin.rpc('claim_family_notification_event');
    if (claimed.error) {
      console.error('Family push event claim failed.', {
        code: claimed.error.code,
      });
      return jsonResponse({ error: 'Event claim failed' }, 500);
    }
    const event = (claimed.data?.[0] ?? null) as FamilyNotificationEvent | null;
    if (!event) break;

    const targets = await admin.rpc('claim_family_notification_targets', {
      requested_limit: 100,
      target_event_id: event.event_id,
    });
    if (targets.error) {
      await admin.rpc('finish_family_notification_event', {
        processing_error: 'Target claim failed',
        target_event_id: event.event_id,
      });
      continue;
    }

    for (const target of (targets.data ?? []) as FamilyPushTarget[]) {
      try {
        const message = buildFamilyPushMessage(event, target);
        const ticket = classifyExpoTicket(
          await sendPush(message, target.delivery_id, useMock),
        );
        await admin.rpc('record_family_push_delivery', {
          delivery_error: 'error' in ticket ? ticket.error : null,
          delivery_outcome: ticket.outcome,
          expo_ticket_id: ticket.outcome === 'ticket' ? ticket.ticketId : null,
          retry_after_seconds:
            ticket.outcome === 'retry' ? ticket.retryAfterSeconds : 60,
          target_delivery_id: target.delivery_id,
        });
      } catch (error) {
        await admin.rpc('record_family_push_delivery', {
          delivery_error: 'Push transport outcome unknown',
          delivery_outcome: 'failed',
          expo_ticket_id: null,
          retry_after_seconds: 60,
          target_delivery_id: target.delivery_id,
        });
        console.error('Family push transport failed.', {
          name: error instanceof Error ? error.name : 'UnknownError',
        });
      }
      deliveriesProcessed += 1;
    }
    await admin.rpc('finish_family_notification_event', {
      processing_error: null,
      target_event_id: event.event_id,
    });
    eventsProcessed += 1;
  }

  return jsonResponse(
    {
      deliveriesProcessed,
      eventsProcessed,
      receiptsProcessed,
      transport: useMock ? 'mock' : 'expo',
    },
    200,
  );
});
