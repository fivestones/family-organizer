import { getServerUrl } from './server-url';
import { getDeviceSessionToken, getParentPrincipalToken } from './device-session-store';
import { CALENDAR_SYNC_PARENT_TOKEN_HEADER } from '../../../lib/calendar-sync-constants';

export function getApiBaseUrl() {
  return getServerUrl();
}

async function authHeaders() {
  const token = await getDeviceSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parentPrincipalHeaders() {
  const token = await getParentPrincipalToken();
  return token ? { [CALENDAR_SYNC_PARENT_TOKEN_HEADER]: token } : {};
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || data?.message || `Request failed (${response.status})`;
    const error = new Error(message);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

export async function mobileDeviceActivate({ accessKey, platform = 'ios', deviceName, appVersion }) {
  const response = await fetch(`${getApiBaseUrl()}/api/mobile/device-activate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accessKey, platform, deviceName, appVersion }),
  });
  return parseJson(response);
}

export async function refreshMobileDeviceSession() {
  const response = await fetch(`${getApiBaseUrl()}/api/mobile/device-session/refresh`, {
    method: 'POST',
    headers: {
      ...(await authHeaders()),
    },
  });
  return parseJson(response);
}

export async function revokeMobileDeviceSession() {
  const response = await fetch(`${getApiBaseUrl()}/api/mobile/device-session/revoke`, {
    method: 'POST',
    headers: {
      ...(await authHeaders()),
    },
  });
  return parseJson(response);
}

export async function getKidInstantToken() {
  const response = await fetch(`${getApiBaseUrl()}/api/mobile/instant-auth-token`, {
    headers: {
      ...(await authHeaders()),
    },
  });
  return parseJson(response);
}

export async function getParentInstantToken({ familyMemberId, pin }) {
  const response = await fetch(`${getApiBaseUrl()}/api/mobile/instant-auth-parent-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({ familyMemberId, pin }),
  });
  return parseJson(response);
}

export async function getMobileFilesList() {
  const response = await fetch(`${getApiBaseUrl()}/api/mobile/files`, {
    headers: {
      ...(await authHeaders()),
    },
  });
  return parseJson(response);
}

export async function getPresignedFileUrl(fileKey) {
  const response = await fetch(
    `${getApiBaseUrl()}/api/mobile/files/${encodeURIComponent(fileKey)}`,
    { headers: await authHeaders() }
  );
  const data = await parseJson(response);
  return data.url;
}

export async function createMobilePresignedUpload({ filename, contentType, scope = 'task-attachment' }) {
  const response = await fetch(`${getApiBaseUrl()}/api/mobile/files/presign`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
    },
    body: JSON.stringify({ filename, contentType, scope }),
  });
  return parseJson(response);
}

export async function getAppleCalendarSyncStatus() {
  const response = await fetch(`${getApiBaseUrl()}/api/calendar-sync/apple/status`, {
    headers: {
      ...(await authHeaders()),
      ...(await parentPrincipalHeaders()),
    },
  });
  return parseJson(response);
}

export async function connectAppleCalendarSync({ username, appSpecificPassword, accountLabel }) {
  const response = await fetch(`${getApiBaseUrl()}/api/calendar-sync/apple/connect`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
      ...(await parentPrincipalHeaders()),
    },
    body: JSON.stringify({ username, appSpecificPassword, accountLabel }),
  });
  return parseJson(response);
}

export async function updateAppleCalendarSyncSettings(payload) {
  const response = await fetch(`${getApiBaseUrl()}/api/calendar-sync/apple/settings`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
      ...(await parentPrincipalHeaders()),
    },
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}

export async function runAppleCalendarSync(payload = {}) {
  const response = await fetch(`${getApiBaseUrl()}/api/calendar-sync/apple/run`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(await authHeaders()),
      ...(await parentPrincipalHeaders()),
    },
    body: JSON.stringify(payload),
  });
  return parseJson(response);
}
