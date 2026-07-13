// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/freeform-dashboard/DashboardThemeContext', () => ({
    useActiveDashboardTheme: () => ({ activeTheme: null }),
}));

import { ThemedHeader } from '@/components/ThemedAppShell';

describe('ThemedHeader', () => {
    it('stays first in the flex app shell even if portal cleanup disturbs DOM insertion order', () => {
        render(<ThemedHeader>Family navigation</ThemedHeader>);

        expect(screen.getByRole('banner')).toHaveClass('order-first');
    });
});
