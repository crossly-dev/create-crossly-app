import type { Metadata } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: '__APP_NAME__',
  description: 'A storefront powered by Crossly.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="site-header">
          <Link href="/" className="brand">
            __APP_NAME__
          </Link>
          <nav>
            <Link href="/">Shop</Link>
            <Link href="/catalog">Drop-in catalog</Link>
          </nav>
        </header>
        <main>{children}</main>
        <footer className="site-footer">
          Checkout is hosted by <a href="https://crossly.net">Crossly</a>. Card details never touch this site.
        </footer>
      </body>
    </html>
  );
}
