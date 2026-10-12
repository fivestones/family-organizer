import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { DEVICE_KEY, ELI, FAY, query, resetFamily } from './support/family';

// The slice of the app that runs on PowerSync, in a real browser, against the real sync service.

test.beforeEach(async () => {
    await resetFamily();
});

/**
 * Opens the app on an activated device. On a PowerSync deployment every page leads to /sync.
 *
 * The activation cookie is put in place directly. The app marks it for secure connections only when it runs a
 * production build, and this test serves one over plain http, where WebKit will not keep such a cookie.
 */
async function open(page: Page) {
    await page.context().addCookies([{ name: 'activation_token', value: createHash('sha256').update(DEVICE_KEY).digest('hex'), url: 'http://127.0.0.1:3210' }]);
    await page.goto('/');
    await expect(page).toHaveURL(/\/sync$/);
    await expect(page.getByTestId('powersync-app')).toHaveAttribute('data-phase', 'ready');
    await expect(page.getByTestId('sync-badge')).toContainText('Up to date');
}

async function signInAs(page: Page, name: string, pin?: string) {
    await page.getByTestId('person-button').click();
    await page.getByTestId('person-option').filter({ hasText: name }).click();
    if (pin) {
        await page.getByTestId('pin-input').fill(pin);
        await page.getByTestId('pin-submit').click();
    }
    await expect(page.getByTestId('person-button')).toContainText(name);
}

const chore = (page: Page, title: string) => page.getByTestId('chore').filter({ hasText: title });
const person = (page: Page, title: string, memberId: string) => chore(page, title).locator(`[data-testid="chore-person"][data-member-id="${memberId}"]`);
const completions = async () => (await query<{ completed_by: string }>(`SELECT completed_by FROM chore_completions WHERE completed_at IS NOT NULL`)).map((row) => row.completed_by);

test('a device with nobody signed in is sent the family and its chores', async ({ page }) => {
    await open(page);

    await expect(page.getByTestId('person-button')).toContainText('Everyone');
    await expect(chore(page, 'Dishes')).toBeVisible();
    await expect(chore(page, 'Laundry')).toContainText('Up for grabs');
    // The shared sign-in is nobody: it can look and cannot tick.
    await expect(person(page, 'Dishes', ELI)).toBeDisabled();
});

test('a kid ticks their chore: it shows at once, reaches the server, and is there in a second tab', async ({ page, context }) => {
    await open(page);
    await signInAs(page, 'Eli');
    await expect(person(page, 'Dishes', FAY)).toBeDisabled();

    await person(page, 'Dishes', ELI).click();

    await expect(person(page, 'Dishes', ELI)).toHaveAttribute('data-done', 'true');
    await expect.poll(completions).toEqual([ELI]);
    await expect(page.getByTestId('sync-badge')).toContainText('Up to date');

    const second = await context.newPage();
    await second.goto('/sync');
    await expect(second.getByTestId('person-button')).toContainText('Eli');
    await expect(person(second, 'Dishes', ELI)).toHaveAttribute('data-done', 'true');

    // Un-ticked in the second tab, it is un-ticked in the first.
    await person(second, 'Dishes', ELI).click();
    await expect(person(page, 'Dishes', ELI)).toHaveAttribute('data-done', 'false');
    await expect.poll(completions).toEqual([]);
});

test('a chore ticked with no network waits on the device and is sent when the network returns', async ({ page, context }) => {
    await open(page);
    await signInAs(page, 'Eli');
    await context.setOffline(true);

    await person(page, 'Laundry', ELI).click();

    await expect(person(page, 'Laundry', ELI)).toHaveAttribute('data-done', 'true');
    await expect(page.getByTestId('sync-badge')).toContainText('1 change waiting');
    expect(await completions()).toEqual([]);

    await context.setOffline(false);
    await expect.poll(completions, { timeout: 30_000 }).toEqual([ELI]);
    await expect(page.getByTestId('sync-badge')).toContainText('Up to date', { timeout: 30_000 });
});

test('the app starts with no network from what it kept, and a chore ticked then is sent later', async ({ page, context, browserName }) => {
    // Playwright's WebKit cannot load or reload any page while offline: it stops with "WebKit encountered an
    // internal error" before the service worker is asked. That says nothing about Safari either way, so on WebKit
    // this is a check for a real iPad and iPhone (docs/powersync-staging.md).
    test.fixme(browserName === 'webkit', 'Playwright\'s WebKit cannot navigate while offline.');
    await open(page);
    await signInAs(page, 'Eli');
    // The page says when the service worker has kept everything it needs to start again without a server.
    await expect(page.getByTestId('powersync-app')).toHaveAttribute('data-starts-offline', 'true', { timeout: 30_000 });
    await context.setOffline(true);

    // Opened afresh, at the app's home address, with nothing to load it from but what was kept.
    expect((await page.goto('/'))?.ok()).toBe(true);
    await expect(page).toHaveURL(/\/sync$/);
    await expect(page.getByTestId('person-button')).toContainText('Eli');
    await expect(chore(page, 'Dishes')).toBeVisible();

    await person(page, 'Dishes', ELI).click();
    await expect(person(page, 'Dishes', ELI)).toHaveAttribute('data-done', 'true');
    await expect(page.getByTestId('sync-badge')).toContainText('1 change waiting');

    await context.setOffline(false);
    await expect.poll(completions, { timeout: 30_000 }).toEqual([ELI]);
});

test('a parent steps in with a PIN, sees the settings, and is signed out back to the kid', async ({ page }) => {
    await open(page);
    await signInAs(page, 'Eli');
    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('settings')).toHaveCount(0);

    await signInAs(page, 'Dana', '2468');
    await page.getByTestId('tab-settings').click();
    await expect(page.getByTestId('settings')).toBeVisible();
    // A parent may tick for a kid, and the server records who pressed.
    await page.getByTestId('tab-chores').click();
    await person(page, 'Dishes', FAY).click();
    await expect.poll(async () => query(`SELECT completed_by, marked_by FROM chore_completions`)).toEqual([{ completed_by: FAY, marked_by: (await query(`SELECT id FROM family_members WHERE name = 'Dana'`))[0].id }]);

    await page.getByTestId('person-button').click();
    await page.getByTestId('sign-out').click();
    await expect(page.getByTestId('person-button')).toContainText('Eli');
    await expect.poll(async () => (await query(`SELECT state FROM auth_sessions WHERE principal_type = 'parent'`))[0]?.state).toBe('ended');
});

test('the wrong PIN signs nobody in', async ({ page }) => {
    await open(page);
    await page.getByTestId('person-button').click();
    await page.getByTestId('person-option').filter({ hasText: 'Fay' }).click();
    await page.getByTestId('pin-input').fill('0000');
    await page.getByTestId('pin-submit').click();

    await expect(page.getByRole('alert')).toContainText('not right');
    expect(await query(`SELECT 1 FROM auth_sessions WHERE family_member_id = $1`, [FAY])).toEqual([]);
});
