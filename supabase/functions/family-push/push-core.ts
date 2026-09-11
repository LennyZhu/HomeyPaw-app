export type FamilyActivityKind = 'journal' | 'care' | 'health' | 'reminder';

export type FamilyNotificationEvent = {
  event_id: string;
  event_type: 'journal_created' | 'care_log_created' | 'reminder_created';
  activity_kind: FamilyActivityKind;
  pet_id: string;
  actor_user_id: string;
  source_id: string;
};

export type FamilyPushTarget = {
  delivery_id: string;
  push_device_id: string;
  expo_push_token: string;
  recipient_locale: string;
};

export type ExpoPushMessage = {
  to: string;
  title: 'HomeyPaw';
  body: string;
  sound: 'default';
  data: {
    type: FamilyNotificationEvent['event_type'];
    petId: string;
    sourceId: string;
  };
};

const localizedBodies = {
  en: {
    journal: 'A family member added a new journal entry.',
    care: 'A family member recorded pet care.',
    health: 'A family member recorded a health observation.',
    reminder: 'A family member added a reminder.',
  },
  'zh-HK': {
    journal: '家人新增了一篇日記',
    care: '家人新增了一筆照顧記錄',
    health: '家人新增了一筆健康狀況記錄',
    reminder: '家人新增了一項提醒',
  },
} as const;

export function buildFamilyPushMessage(
  event: FamilyNotificationEvent,
  target: FamilyPushTarget,
): ExpoPushMessage {
  const locale = target.recipient_locale === 'en' ? 'en' : 'zh-HK';
  return {
    to: target.expo_push_token,
    title: 'HomeyPaw',
    body: localizedBodies[locale][event.activity_kind],
    sound: 'default',
    data: {
      type: event.event_type,
      petId: event.pet_id,
      sourceId: event.source_id,
    },
  };
}

export type DeliveryResult =
  | { outcome: 'ticket'; ticketId: string }
  | { outcome: 'retry'; error: string; retryAfterSeconds: number }
  | { outcome: 'device_not_registered'; error: string }
  | { outcome: 'failed'; error: string };

export function classifyExpoTicket(value: unknown): DeliveryResult {
  if (!value || typeof value !== 'object') {
    return { outcome: 'failed', error: 'Malformed Expo push ticket' };
  }
  const ticket = value as {
    status?: unknown;
    id?: unknown;
    message?: unknown;
    details?: { error?: unknown };
  };
  if (ticket.status === 'ok' && typeof ticket.id === 'string') {
    return { outcome: 'ticket', ticketId: ticket.id };
  }
  const code = ticket.details?.error;
  const message =
    typeof ticket.message === 'string' ? ticket.message : 'Expo push rejected';
  if (code === 'DeviceNotRegistered') {
    return { outcome: 'device_not_registered', error: message };
  }
  if (
    code === 'MessageRateExceeded' ||
    code === 'MessageTooBig' ||
    code === 'MismatchSenderId'
  ) {
    return code === 'MessageRateExceeded'
      ? { outcome: 'retry', error: message, retryAfterSeconds: 60 }
      : { outcome: 'failed', error: message };
  }
  return { outcome: 'failed', error: message };
}

export type ReceiptResult =
  | { outcome: 'delivered' }
  | { outcome: 'pending'; error: string }
  | { outcome: 'device_not_registered'; error: string }
  | { outcome: 'failed'; error: string };

export function classifyExpoReceipt(value: unknown): ReceiptResult {
  if (value === undefined) {
    return { outcome: 'pending', error: 'Expo receipt is not ready' };
  }
  if (!value || typeof value !== 'object') {
    return { outcome: 'failed', error: 'Malformed Expo push receipt' };
  }
  const receipt = value as {
    status?: unknown;
    message?: unknown;
    details?: { error?: unknown };
  };
  if (receipt.status === 'ok') return { outcome: 'delivered' };
  const message =
    typeof receipt.message === 'string'
      ? receipt.message
      : 'Expo push delivery failed';
  return receipt.details?.error === 'DeviceNotRegistered'
    ? { outcome: 'device_not_registered', error: message }
    : { outcome: 'failed', error: message };
}

export function isTrustedServiceAuthorization(
  authorization: string | null,
  serviceRoleKey: string,
) {
  if (!authorization?.startsWith('Bearer ')) return false;
  const token = authorization.slice('Bearer '.length);
  if (token === serviceRoleKey) return true;

  // config.toml requires gateway JWT verification before this code runs. Local
  // Supabase sends the verified legacy service-role JWT while the function
  // receives the newer secret key through SUPABASE_SECRET_KEYS.
  const payloadPart = token.split('.')[1];
  if (!payloadPart) return false;
  try {
    const normalized = payloadPart.replace(/-/gu, '+').replace(/_/gu, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return payload.role === 'service_role';
  } catch {
    return false;
  }
}
