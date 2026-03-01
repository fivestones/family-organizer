import { init } from '@instantdb/react-native';
import schema from '../../../instant.schema';

const DEFAULT_INSTANT_APP_ID = '69a7badb-2401-462a-b414-bd63f6e6f897';

const APP_ID =
  process.env.EXPO_PUBLIC_INSTANT_APP_ID ||
  process.env.NEXT_PUBLIC_INSTANT_APP_ID ||
  DEFAULT_INSTANT_APP_ID;

const apiURI = process.env.EXPO_PUBLIC_INSTANT_API_URI || process.env.NEXT_PUBLIC_INSTANT_API_URI;
const websocketURI =
  process.env.EXPO_PUBLIC_INSTANT_WEBSOCKET_URI || process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI;

const connectionConfig = apiURI && websocketURI ? { apiURI, websocketURI } : {};

export const db = init({
  appId: APP_ID,
  schema,
  ...connectionConfig,
});

