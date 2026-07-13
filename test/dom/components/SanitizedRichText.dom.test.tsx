// @vitest-environment jsdom

import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SanitizedRichText } from '@/components/responses/SanitizedRichText';

describe('SanitizedRichText', () => {
    it('keeps authored formatting while removing executable markup', () => {
        const { container } = render(
            <SanitizedRichText
                html={'<p><strong>Safe answer</strong></p><img src="x" onerror="alert(1)"><script>alert(2)</script>'}
            />
        );

        expect(screen.getByText('Safe answer')).toBeInTheDocument();
        expect(container.querySelector('strong')).toBeInTheDocument();
        expect(container.querySelector('script')).not.toBeInTheDocument();
        expect(container.querySelector('img')).not.toHaveAttribute('onerror');
    });
});
