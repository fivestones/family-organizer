import { EB_Garamond } from 'next/font/google';

const ebGaramond = EB_Garamond({
  weight: '400',
  subsets: ['latin'],
  style: 'normal',
  display: 'swap',
});

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={ebGaramond.className}>
      <body>{children}</body>
    </html>
  );
}
