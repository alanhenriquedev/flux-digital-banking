const UA_MAX_LENGTH = 255;
const UA_RESPONSE_LENGTH = 100;
const IP_MAX_LENGTH = 45;
const DEVICE_ID_MAX_LENGTH = 64;

import { createHmac } from 'crypto';

export function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) return null;
  return value.length > max ? value.slice(0, max) : value;
}

/**
 * Identificador de dispositivo (agrupamento de sessões, V1):
 * - gerado no navegador com crypto.randomUUID() e persistido em localStorage;
 * - é apenas um HINT de agrupamento: NÃO é fator de autenticação,
 *   NÃO substitui o JWT e NÃO concede acesso;
 * - o valor cru nunca é persistido — o servidor guarda somente o HMAC.
 */
const UUID_V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidDeviceId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= DEVICE_ID_MAX_LENGTH &&
    UUID_V4_RE.test(value)
  );
}

export function hashDeviceId(deviceId: string, secret: string): string {
  return createHmac('sha256', secret).update(deviceId, 'utf8').digest('hex');
}

export function maskIp(ip: string | null | undefined): string | null {
  if (!ip) return null;

  const ipv4 =
    /^.*:ffff:(?<v4>\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip)?.groups?.v4 ??
    (/^(\d{1,3}(?:\.\d{1,3}){3})$/.test(ip) ? ip : null);

  if (ipv4) {
    const parts = ipv4.split('.');
    return `${parts[0]}.${parts[1]}.***.***`;
  }

  if (ip.includes(':')) {
    const groups = ip.split(':').filter(Boolean);
    const keep = groups.slice(0, 2).join(':');
    return `${keep}:****:****:****:****`;
  }

  const parts = ip.split('.');
  return `${parts[0]}.${parts[1]}.***.***`;
}

function detectOs(ua: string): string {
  if (/iPhone/i.test(ua)) return 'no iPhone';
  if (/iPad/i.test(ua)) return 'no iPad';
  if (/Android/i.test(ua)) return 'no Android';
  if (/Windows NT/i.test(ua)) return 'no Windows';
  if (/Mac OS X/i.test(ua)) return 'no macOS';
  if (/Linux/i.test(ua)) return 'no Linux';
  return 'em outro sistema';
}

function detectBrowser(ua: string): string {
  if (/Edg\//i.test(ua)) return 'Edge';
  if (/OPR\/|Opera/i.test(ua)) return 'Opera';
  if (/SamsungBrowser/i.test(ua)) return 'Samsung Internet';
  if (/Firefox\//i.test(ua)) return 'Firefox';
  if (/Chrome\//i.test(ua)) return 'Chrome';
  if (/Safari\//i.test(ua)) return 'Safari';
  return 'Navegador';
}

export function summarizeUserAgent(ua: string | null | undefined): string | null {
  if (!ua) return null;
  return `${detectBrowser(ua)} ${detectOs(ua)}`;
}

export interface LoginContext {
  ip?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
}

export function sanitizeIp(value: string | null | undefined): string | null {
  return truncate(value, IP_MAX_LENGTH);
}

export function sanitizeUserAgent(value: string | null | undefined): string | null {
  return truncate(value, UA_MAX_LENGTH);
}

export function summarizeUserAgentResponse(value: string | null | undefined): string | null {
  return truncate(value, UA_RESPONSE_LENGTH);
}