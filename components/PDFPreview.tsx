'use client';

import React from 'react';
import { PdfLoader, PdfHighlighter } from 'react-pdf-highlighter';
import { Loader2 } from 'lucide-react';

// --- ADD THIS IMPORT ---
import 'react-pdf-highlighter/dist/style.css';
// -----------------------

interface Props {
    url: string;
}

export const PDFPreview = ({ url }: Props) => {
    return (
        <div className="relative w-full h-full bg-gray-100">
            <PdfLoader
                url={url}
                beforeLoad={
                    <div className="flex items-center justify-center h-full text-muted-foreground gap-2">
                        <Loader2 className="h-6 w-6 animate-spin" />
                        Loading PDF...
                    </div>
                }
                // UPDATED: Back to .mjs for Version 4.x
                workerSrc="/pdf.worker.min.mjs"
                onError={(error) => {
                    console.error('PDF Render Error:', error);
                }}
                errorMessage={(error) => (
                    <div className="flex flex-col items-center justify-center h-full text-red-500 p-4 text-center">
                        <p className="font-bold">Failed to render PDF.</p>
                        <p className="text-xs text-gray-500 mt-2 max-w-md break-all">{error instanceof Error ? error.message : JSON.stringify(error)}</p>
                    </div>
                )}
            >
                {(pdfDocument) => (
                    <PdfHighlighter
                        pdfDocument={pdfDocument}
                        enableAreaSelection={(event) => event.altKey}
                        onScrollChange={() => {}}
                        // No-op for now
                        scrollRef={() => {}}
                        onSelectionFinished={() => null}
                        highlightTransform={() => null}
                        highlights={[]}
                    />
                )}
            </PdfLoader>
        </div>
    );
};
