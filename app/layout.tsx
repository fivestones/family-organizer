import localFont from 'next/font/local';
import type { Metadata, Viewport } from 'next'; // Added Viewport type
import './globals.css';
import { TimeMachineBootstrap } from '@/components/debug/TimeMachineBootstrap';
import { AppShell } from '@/components/AppShell';
// Import local Inter font
const inter = localFont({
    src: '../public/fonts/Inter_18pt-Regular.ttf',
    weight: '400', // You can change this based on the weights you're using
    display: 'swap',
});

// Import local Inter font
const interBold = localFont({
    src: '../public/fonts/Inter_18pt-Bold.ttf',
    weight: '400', // You can change this based on the weights you're using
    display: 'swap',
});
// Import local Inter font
const interItalic = localFont({
    src: '../public/fonts/Inter_18pt-Italic.ttf',
    weight: '400', // You can change this based on the weights you're using
    display: 'swap',
});
// Import local Inter font
const interBoldItalic = localFont({
    src: '../public/fonts/Inter_18pt-BoldItalic.ttf',
    weight: '400', // You can change this based on the weights you're using
    display: 'swap',
});

// Import local EB Garamond font
const ebGaramond = localFont({
    src: '../public/fonts/EBGaramond-Regular.ttf',
    weight: '400', // Adjust this if using different weights
    display: 'swap',
});

// +++ NEW: Viewport configuration for PWA behavior +++
export const viewport: Viewport = {
    themeColor: '#ffffff', // Changes the color of the status bar on iOS
    width: 'device-width',
    initialScale: 1,
    maximumScale: 1, // Disables auto-zoom on inputs, making it feel like a native app
    userScalable: false, // Prevents pinch-to-zoom
    viewportFit: 'cover',
};

// +++ MODIFIED: Metadata for iOS PWA support +++
export const metadata: Metadata = {
    title: 'Family Organizer',
    description: 'Family Organizer App',
    manifest: '/manifest.json', // You must create this file in /public
    appleWebApp: {
        capable: true, // This is crucial: it hides the Safari UI (address bar)
        statusBarStyle: 'default', // Options: 'default', 'black', or 'black-translucent'
        title: 'Family Org', // The short name shown under the icon on the home screen
    },
    formatDetection: {
        telephone: false, // Prevents phone numbers from turning into blue links
    },
};

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <head>
                <TimeMachineBootstrap />
            </head>
            <body className={`${inter.className} flex h-dvh flex-col overflow-hidden bg-background text-foreground overscroll-none`}>
                {/* The frame, with its providers and header, depends on which backend the page runs on. */}
                <AppShell>{children}</AppShell>
            </body>
        </html>
    );
}
