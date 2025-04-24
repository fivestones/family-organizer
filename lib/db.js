import { init } from '@instantdb/react';

// export const { db, tx } = init({ appId: 'YOUR_APP_ID' });

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4' //kepler.local

export const db  = init({
  appId: APP_ID,
  apiURI: "http://localhost:8888",
  websocketURI: "ws://localhost:8888/runtime/session",
});