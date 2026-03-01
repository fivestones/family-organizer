import { init } from '@instantdb/react-native';
import schema from '../../../instant.schema';

const APP_ID =
  process.env.EXPO_PUBLIC_INSTANT_APP_ID ||
  process.env.NEXT_PUBLIC_INSTANT_APP_ID;

if (!APP_ID) {
  throw new Error('EXPO_PUBLIC_INSTANT_APP_ID or NEXT_PUBLIC_INSTANT_APP_ID must be defined');
}

const apiURI = process.env.EXPO_PUBLIC_INSTANT_API_URI || process.env.NEXT_PUBLIC_INSTANT_API_URI;
const websocketURI =
  process.env.EXPO_PUBLIC_INSTANT_WEBSOCKET_URI || process.env.NEXT_PUBLIC_INSTANT_WEBSOCKET_URI;

const connectionConfig = apiURI && websocketURI ? { apiURI, websocketURI } : {};

export const db = init({
  appId: APP_ID,
  schema,
  ...connectionConfig,
});

