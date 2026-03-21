import { Redirect } from 'expo-router';

// This tab is intercepted by a tabPress listener in _layout.js to open the profile menu modal.
// If somehow navigated to directly, redirect to the dashboard.
export default function ProfileMenuPlaceholder() {
  return <Redirect href="/dashboard" />;
}
