import { expect, test } from '@playwright/test';
import { activateDevice } from './support/device-auth';

test.describe('device auth + Instant auth smoke', () => {
    test('blocks kid token route before activation', async ({ request }) => {
        const response = await request.get('/api/instant-auth-token');
        expect(response.status()).toBe(401);
    });

    test('activates device and can fetch a kid principal token', async ({ page }) => {
        await activateDevice(page);

        await expect(page).toHaveURL(/\/$/);

        const tokenResponse = await page.evaluate(async () => {
            const response = await fetch('/api/instant-auth-token', {
                method: 'GET',
                credentials: 'same-origin',
                cache: 'no-store',
            });

            let body: any = null;
            try {
                body = await response.json();
            } catch {
                body = null;
            }

            return {
                status: response.status,
                body,
                cookieEnabled: document.cookie.includes('family_device_auth='),
            };
        });

        expect(tokenResponse.status).toBe(200);
        expect(tokenResponse.body?.principalType).toBe('kid');
        expect(typeof tokenResponse.body?.token).toBe('string');
        // HttpOnly cookie won't appear in document.cookie; the API success is the real proof.
        expect(tokenResponse.cookieEnabled).toBe(false);
    });
});
