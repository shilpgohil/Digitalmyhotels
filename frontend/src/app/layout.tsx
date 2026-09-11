import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans, Noto_Sans_Devanagari } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Providers } from "@/components/providers";
import { Toaster } from "@/components/ui/sonner";
import { RouteLoader } from "@/components/ui/route-loader";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

/**
 * Plus Jakarta Sans replaces Source Serif 4 for display/heading text.
 * Rationale: warm humanist-geometric feel matches hospitality SaaS;
 * crisp at all sizes; better than a serif for an operational dashboard.
 * Weights: 400 body-level, 500/600/700/800 for hierarchy.
 */
const plusJakarta = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-plus-jakarta",
  display: "swap",
  weight: ["400", "500", "600", "700", "800"],
});

const notoDevanagari = Noto_Sans_Devanagari({
  subsets: ["devanagari"],
  variable: "--font-devanagari",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "DigitalMyHotels",
    template: "%s · DigitalMyHotels",
  },
  description: "Hotel management platform — bookings, front desk, billing and operations.",
  icons: {
    icon: "/dmh-icon.png",
    apple: "/dmh-icon.png",
    shortcut: "/dmh-icon.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} suppressHydrationWarning>
      <body
        className={`${inter.variable} ${plusJakarta.variable} ${notoDevanagari.variable} font-sans`}
        style={
          {
            "--font-sans-stack": `var(--font-inter), var(--font-devanagari), system-ui, sans-serif`,
            "--font-display-stack": `var(--font-plus-jakarta), var(--font-devanagari), system-ui, sans-serif`,
          } as React.CSSProperties
        }
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* Logo spinner — fires on every client navigation */}
          <RouteLoader />
          <Providers>{children}</Providers>
          <Toaster position="top-right" richColors />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
