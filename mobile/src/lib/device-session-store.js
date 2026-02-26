import * as SecureStore from 'expo-secure-store';

const DEVICE_SESSION_TOKEN_KEY = 'familyOrganizer.deviceSessionToken';
const PARENT_PRINCIPAL_TOKEN_KEY = 'familyOrganizer.parentPrincipalToken';

export async function getDeviceSessionToken() {
  return SecureStore.getItemAsync(DEVICE_SESSION_TOKEN_KEY);
}

export async function setDeviceSessionToken(token) {
  if (!token) {
    await SecureStore.deleteItemAsync(DEVICE_SESSION_TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(DEVICE_SESSION_TOKEN_KEY, token);
}

export async function getParentPrincipalToken() {
  return SecureStore.getItemAsync(PARENT_PRINCIPAL_TOKEN_KEY);
}

export async function setParentPrincipalToken(token) {
  if (!token) {
    await SecureStore.deleteItemAsync(PARENT_PRINCIPAL_TOKEN_KEY);
    return;
  }
  await SecureStore.setItemAsync(PARENT_PRINCIPAL_TOKEN_KEY, token);
}

