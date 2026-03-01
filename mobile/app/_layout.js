import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { AppProviders } from '../src/providers/AppProviders';
import { ThemeProvider, useAppTheme } from '../src/theme/ThemeProvider';
import { preloadServerUrl, fetchServerConfig } from '../src/lib/server-url';
import { initInstantDb } from '../src/lib/instant-db';

const BootstrapContext = createContext(null);

export function useBootstrap() {
  return useContext(BootstrapContext);
}

function ServerUrlGate({ children }) {
  const [ready, setReady] = useState(false);
  // Incrementing the key forces AppProviders to fully remount after re-bootstrap
  const [mountKey, setMountKey] = useState(0);

  const runBootstrap = useCallback(async () => {
    await preloadServerUrl();
    const config = await fetchServerConfig();
    if (config?.instantAppId) {
      initInstantDb({
        appId: config.instantAppId,
        apiURI: config.instantApiURI,
        websocketURI: config.instantWebsocketURI,
      });
    }
  }, []);

  useEffect(() => {
    runBootstrap().then(() => setReady(true));
  }, [runBootstrap]);

  const rebootstrap = useCallback(async () => {
    await runBootstrap();
    setMountKey((k) => k + 1);
  }, [runBootstrap]);

  if (!ready) return null;

  return (
    <BootstrapContext.Provider value={{ rebootstrap }}>
      <React.Fragment key={mountKey}>{children}</React.Fragment>
    </BootstrapContext.Provider>
  );
}

function RootNavigator() {
  const { colors } = useAppTheme();

  return (
    <>
      <StatusBar style="dark" backgroundColor={colors.bg} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: colors.bg },
          animation: 'fade',
        }}
      />
    </>
  );
}

export default function RootLayout() {
  return (
    <ThemeProvider>
      <ServerUrlGate>
        <AppProviders>
          <RootNavigator />
        </AppProviders>
      </ServerUrlGate>
    </ThemeProvider>
  );
}
