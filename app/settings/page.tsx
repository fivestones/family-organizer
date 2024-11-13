'use client'

import React from 'react';
import { init } from '@instantdb/react';
import CurrencySettings from '@/components/CurrencySettings';

const APP_ID = 'af77353a-0a48-455f-b892-010232a052b4';
const db = init({
  appId: APP_ID,
  apiURI: "http://kepler.local:8888",
  websocketURI: "ws://kepler.local:8888/runtime/session",
});

export default function SettingsPage() {
  return (
    <div className="container mx-auto p-8">
      <h1 className="text-3xl font-bold mb-8">Settings</h1>
      <CurrencySettings db={db} />
    </div>
  );
} 