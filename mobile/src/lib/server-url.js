import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { getDeviceSessionToken } from './device-session-store';

const STORAGE_KEY = 'familyOrganizer.serverUrl';
const CONFIG_CACHE_KEY = 'familyOrganizer.serverConfig';

// Module-level cache. Preloaded before any provider mounts.
let _cachedUrl = null;
let _cachedConfig = null;

/**
 * Synchronous read of the server URL.
 * Falls back to env var -> expo config -> localhost.
 */
export function getServerUrl() {
  if (_cachedUrl) return _cachedUrl;

  const raw =
    process.env.EXPO_PUBLIC_API_BASE_URL ||
    Constants.expoConfig?.extra?.apiBaseUrl ||
    'http://localhost:3000';

  return /^https?:\/\//i.test(raw) ? raw : `http://${raw}`;
}

/**
 * Async one-time read from AsyncStorage into the module cache.
 * Must be awaited before any API calls fire.
 */
export async function preloadServerUrl() {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    if (stored) {
      _cachedUrl = stored;
    }
  } catch {
    // Best-effort; fall through to env var / default.
  }
}

/**
 * Persist a new server URL and update the module cache immediately.
 */
export async function setServerUrl(url) {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    await clearServerUrl();
    return;
  }
  const normalized = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  const cleaned = normalized.replace(/\/+$/, '');
  _cachedUrl = cleaned;
  await AsyncStorage.setItem(STORAGE_KEY, cleaned);
}

/**
 * Clear stored URL; reverts to env var / default fallback.
 */
export async function clearServerUrl() {
  _cachedUrl = null;
  _cachedConfig = null;
  try {
    await AsyncStorage.multiRemove([STORAGE_KEY, CONFIG_CACHE_KEY]);
  } catch {
    // Best-effort.
  }
}

/**
 * Fetch config from the server (InstantDB app ID, etc.) and cache it.
 * Uses a locally cached version first, then tries to refresh from network.
 * Returns the config object or null if unavailable.
 */
export async function fetchServerConfig() {
  // Try cached config first
  if (!_cachedConfig) {
    try {
      const stored = await AsyncStorage.getItem(CONFIG_CACHE_KEY);
      if (stored) {
        _cachedConfig = JSON.parse(stored);
      }
    } catch {
      // Ignore parse errors
    }
  }

  // Try to fetch fresh config from the server (requires device session token)
  const serverUrl = getServerUrl();
  const token = await getDeviceSessionToken();
  try {
    const headers = token ? { Authorization: `Bearer ${token}` } : {};
    const response = await fetch(`${serverUrl}/api/mobile/config`, { headers });
    if (response.ok) {
      const config = await response.json();
      _cachedConfig = config;
      await AsyncStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify(config));
    }
  } catch {
    // Network failure — use cached config if available
  }

  return _cachedConfig;
}

/**
 * Get the cached server config synchronously. Returns null if not yet fetched.
 */
export function getServerConfig() {
  return _cachedConfig;
}
