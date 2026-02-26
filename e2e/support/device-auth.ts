import type { Page } from '@playwright/test';

export const e2eActivationKey = process.env.E2E_DEVICE_ACCESS_KEY || process.env.DEVICE_ACCESS_KEY || 'local-dev-device-access-key';

export async function activateDevice(page: Page, activationKey = e2eActivationKey) {
    await page.goto(`/?activate=${encodeURIComponent(activationKey)}`);
}
