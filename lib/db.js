import { init } from '@instantdb/react';

// export const { db, tx } = init({ appId: 'YOUR_APP_ID' });

const APP_ID = 'df733414-7ccd-45bd-85f3-ffd0b3da8812'; //kepler.local

export const db = init({
    appId: APP_ID,
    apiURI: 'http://localhost:8888',
    websocketURI: 'ws://localhost:8888/runtime/session',
});
