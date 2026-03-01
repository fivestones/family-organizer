import { init } from '@instantdb/react-native';
import schema from '../../../instant.schema';

// Lazy initialization: db starts as null and is set by initInstantDb().
// The ServerUrlGate in _layout.js calls initInstantDb() with config fetched
// from the server before any providers mount, so db is always ready by the
// time InstantPrincipalProvider and FamilyAuthProvider render.
export let db = null;

/**
 * Initialize the InstantDB client with a server-provided app ID.
 * Must be called exactly once before any provider that uses `db` mounts.
 *
 * Falls back to env vars if no arguments are provided (for backwards compat).
 */
export function initInstantDb({ appId, apiURI, websocketURI } = {}) {
  if (db) return;

  const resolvedAppId =
    appId ||
    process.env.EXPO_PUBLIC_INSTANT_APP_ID ||
    process.env.NEXT_PUBLIC_INSTANT_APP_ID;

  if (!resolvedAppId) {
    throw new Error('initInstantDb requires an appId (pass it or set EXPO_PUBLIC_INSTANT_APP_ID)');
  }

  const resolvedApiURI = apiURI || process.env.EXPO_PUBLIC_INSTANT_API_URI || process.env.NEXT_PUBLIC_INSTANT_API_URI;
  const resolvedWsURI = websocketURI || process.env.EXPO_PUBLIC_INSTANT_WEBSOCKET_URI || process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI;
  const connectionConfig = resolvedApiURI && resolvedWsURI ? { apiURI: resolvedApiURI, websocketURI: resolvedWsURI } : {};

  db = init({
    appId: resolvedAppId,
    schema,
    ...connectionConfig,
  });
}
