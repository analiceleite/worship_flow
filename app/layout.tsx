import type { Metadata } from 'next'
import type { Viewport } from 'next'
import { Geist, Geist_Mono } from 'next/font/google'
import { PrivacyAwareAnalytics } from '@/components/privacy-aware-analytics'
import { PwaRegister } from '@/components/pwa-register'
import { ThemeProvider } from '@/components/theme-provider'
import { ApplicationShell } from '@/components/application-shell'
import { Toaster } from '@/components/ui/sonner'
import './globals.css'

const _geist = Geist({ subsets: ["latin"] });
const _geistMono = Geist_Mono({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: 'Worship Flow - Igreja PV',
  description: 'Gerenciamento de repertório musical para ministério de louvor',
  manifest: '/manifest.webmanifest',
  generator: 'v0.app',
  icons: {
    icon: [
      {
        url: '/logo.jpg',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/logo.jpg',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/logo.jpg',
        type: 'image/jpeg',
      },
    ],
    apple: '/logo.jpg',
  },
}

export const viewport: Viewport = {
  themeColor: '#0f172a',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const isProduction = process.env.NODE_ENV === 'production'

  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {isProduction ? <PwaRegister /> : null}
          <ApplicationShell>{children}</ApplicationShell>
          <PrivacyAwareAnalytics />
          <Toaster position="top-right" closeButton />
        </ThemeProvider>
      </body>
    </html>
  )
}
