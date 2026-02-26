import Constants from 'expo-constants';
import { getDeviceSessionToken } from './device-session-store';

function getApiBaseUrl() {
  const raw =
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    Constants.expoConfig?.extra?.apiBaseUrl ||
    'http://localhost:3000';

  if (/^https?:\/\//i.test(raw)) {
    return raw;
  }

  return `http://${raw}`;
}

async function authHeaders() {
  const token = await getDeviceSessionToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function parseJson(response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error || `Request failed (${response.status})`;
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
