import { expect, test } from '@playwright/test';

const activationKey = process.env.E2E_DEVICE_ACCESS_KEY || process.env.DEVICE_ACCESS_KEY || 'local-dev-device-access-key';
const parentName = process.env.E2E_PARENT_NAME;
const parentPin = process.env.E2E_PARENT_PIN;
const parentRoute = process.env.E2E_PARENT_ROUTE || '/settings';

test.describe('parent elevation flow (env-gated)', () => {
    test.skip(!parentName || !parentPin, 'Set E2E_PARENT_NAME and E2E_PARENT_PIN to run parent-elevation E2E tests.');

    test('parent can unlock a parent-only page and logout returns to restricted view', async ({ page }) => {
        await page.goto(`/?activate=${encodeURIComponent(activationKey)}`);
        await page.goto(parentRoute);

        await expect(page.getByText('Access Restricted')).toBeVisible();
        await expect(page.getByRole('dialog')).toBeVisible();

        await page.getByRole('button', { name: new RegExp(parentName!, 'i') }).click();
        await page.getByPlaceholder(/pin/i).fill(parentPin!);

        const sharedDeviceCheckbox = page.getByLabel(/this is a shared device/i);
        if (await sharedDeviceCheckbox.count()) {
            await sharedDeviceCheckbox.check();
        }

        await page.getByRole('button', { name: /^log in$/i }).click();

        await expect(page.getByRole('heading', { name: /settings/i })).toBeVisible();

        await page.getByRole('button', { name: /open user menu/i }).click();
        await page.getByRole('menuitem', { name: /log out/i }).click();

        await expect(page.getByText('Access Restricted')).toBeVisible();
        await expect(page.getByRole('button', { name: /open login/i })).toBeVisible();

        const principal = await page.evaluate(() => window.localStorage.getItem('family_organizer_preferred_principal'));
        expect(principal).toBe('kid');
    });
});
