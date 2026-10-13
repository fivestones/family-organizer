'use client';

import { currentDevice } from '@family-organizer/data/powersync/current';
import { SESSION_TOKEN_HEADER } from '@family-organizer/data/session/platform';

// For the few things in the web app that are handed the signed-in person's session rather than asked through the
// data layer: a server action, which takes it as an argument, and an upload sent as a form.

export const sessionToken = (): string => currentDevice().sessionToken;
export const sessionHeaders = (): Record<string, string> => ({ [SESSION_TOKEN_HEADER]: sessionToken() });
