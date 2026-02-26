import { expect, test } from '@playwright/test';
import { activateDevice } from './support/device-auth';

test.describe('DebugTimeWidget smoke', () => {
    test('can open, travel time via the widget UI, and reset to real time', async ({ page }) => {
        await activateDevice(page);

        await page.getByRole('button', { name: /open time machine/i }).click();
        await page.locator('input[type="datetime-local"]').fill('2032-06-01T09:30');
        await page.getByRole('button', { name: /^travel$/i }).click();

        await expect
            .poll(async () => page.evaluate(() => new Date().getUTCFullYear()), { timeout: 5000 })
            .toBe(2032);

        await page.getByRole('button', { name: /open time machine/i }).click();
        await page.getByRole('button', { name: /reset to real time/i }).click();

        await expect
            .poll(async () => page.evaluate(() => new Date().getUTCFullYear()), { timeout: 5000 })
            .not.toBe(2032);
    });
});
