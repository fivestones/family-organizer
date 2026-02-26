const path = require('path');
const { getDefaultConfig } = require('expo/metro-config');

const config = getDefaultConfig(__dirname);

// The web app at the repo root uses React 18 while Expo SDK 54 uses React 19.
// Force only React (and react subpaths) to resolve from the mobile workspace,
// while preserving Expo's default monorepo resolver behavior for everything
// else so nested transitive deps resolve correctly (e.g. Expo's own
// webidl-conversions@5 nested under whatwg-url-without-unicode).
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === 'react' || moduleName.startsWith('react/')) {
    const target = path.resolve(__dirname, 'node_modules', moduleName);
    return context.resolveRequest(context, target, platform);
  }

  return context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
