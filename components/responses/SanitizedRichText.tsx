'use client';

import React, { useMemo } from 'react';
import DOMPurify from 'dompurify';

import { cn } from '@/lib/utils';

export function SanitizedRichText({ html, className }: { html: string; className?: string }) {
    const sanitizedHtml = useMemo(() => DOMPurify.sanitize(html || ''), [html]);
    if (!sanitizedHtml) return null;

    return <div className={cn(className)} dangerouslySetInnerHTML={{ __html: sanitizedHtml }} />;
}
