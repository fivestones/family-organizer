import localFont from 'next/font/local';
import type { Metadata } from 'next';
import './globals.css';
import { Toaster } from '@/components/ui/toaster';
import DebugTimeWidget from '@/components/debug/DebugTimeWidget';
// +++ NEW: Imports for Auth and Navigation +++
import { AuthProvider } from '@/components/AuthProvider';
import { UserMenu } from '@/components/auth/UserMenu';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import NavbarDate from '@/components/NavbarDate'; // Import the new date component

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

export const metadata: Metadata = {
    title: 'Family Organizer',
    description: 'Family Organizer App',
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
            <body className={`${inter.className} min-h-screen flex flex-col bg-background text-foreground`}>
                <AuthProvider>
                    {/* +++ Global Header +++ */}
                    <header className="flex items-center justify-between px-6 py-3 border-b bg-card">
                        <div className="flex items-center gap-6">
                            <Link href="/" className="text-xl font-bold tracking-tight hover:opacity-80 transition-opacity">
                                Family Organizer
                            </Link>
                            <nav className="flex items-center gap-2">
                                <Link href="/">
                                    <Button variant="ghost">Chores</Button>
                                </Link>
                                <Link href="/calendar">
                                    <Button variant="ghost">Calendar</Button>
                                </Link>
                                <Link href="/task-series">
                                    <Button variant="ghost">Task Series</Button>
                                </Link>
                                <Link href="/familyMemberDetail">
                                    <Button variant="ghost">Manage Allowance and Finances</Button>
                                </Link>
                                <Link href="/allowance-distribution">
                                    <Button variant="ghost">Allowance Distribution</Button>
                                </Link>
                                <Link href="/settings">
                                    <Button variant="ghost">Settings</Button>
                                </Link>
                            </nav>
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
