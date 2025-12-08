import localFont from 'next/font/local';
import type { Metadata, Viewport } from 'next'; // Added Viewport type
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import DebugTimeWidget from '@/components/debug/DebugTimeWidget';
// +++ NEW: Imports for Auth and Navigation +++
import { AuthProvider } from '@/components/AuthProvider';
import { UserMenu } from '@/components/auth/UserMenu';
import Link from 'next/link';

import NavbarDate from '@/components/NavbarDate';
import { MainNav } from '@/components/MainNav';
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

// Inline script to patch Date before hydration starts
const timeMachineScript = `
  (function() {
    try {
      var key = 'debug_time_offset';
      var stored = localStorage.getItem(key);
      var offset = stored ? parseInt(stored, 10) : 0;
      
      if (offset === 0 || isNaN(offset)) return;

      var RealDate = window.Date;
      window.__RealDate = RealDate; // Backup

      class MockDate extends RealDate {
        constructor(...args) {
          if (args.length === 0) {
            super(RealDate.now() + offset);
          } else {
            super(...args);
          }
        }
        static now() {
          return RealDate.now() + offset;
        }
      }
      
      // Inherit static methods like parse, UTC
      // (Class extends handles this automatically in modern JS)

      window.Date = MockDate;
      console.log('[TimeMachine] ⚡ Early patch applied via inline script. Offset:', offset);
    } catch(e) {
      console.error('[TimeMachine] Failed to apply early patch:', e);
    }
  })();
`;

export default function RootLayout({
    children,
}: Readonly<{
    children: React.ReactNode;
}>) {
    return (
        <html lang="en">
            <head>
                {/* Inject blocking script here */}
                <script dangerouslySetInnerHTML={{ __html: timeMachineScript }} />
            </head>
            {/* Added flex column structure to body to support the sticky header behavior */}
            {/* Added 'overscroll-none' to prevent that bouncy "rubber banding" effect at the top/bottom */}
            <body className={`${inter.className} min-h-screen flex flex-col bg-background text-foreground overscroll-none`}>
                <AuthProvider>
                    {/* +++ Global Header +++ */}
                    <header className="flex items-center justify-between px-6 py-3 border-b bg-card">
                        <div className="flex items-center gap-6">
                            <Link href="/" className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity">
                                Family Organizer
                            </Link>
                            {/* +++ Swapped inline nav for the new Client Component +++ */}
                            {/* +++ FIX: Wrap MainNav in hidden md:block to explicitly hide on mobile +++ */}
                            <div className="hidden md:block">
                                <MainNav />
                            </div>
                        </div>
                        <div className="flex items-center">
                            <NavbarDate />
                            <UserMenu />
                        </div>
                    </header>

                    {/* +++ Main Content +++ */}
                    <main className="flex-1 relative">{children}</main>

                    <Toaster />
                    <DebugTimeWidget />
                </AuthProvider>
            </body>
        </html>
    );
}
