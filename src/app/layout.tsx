import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { BrandMark, navItems } from "@/lib/nav";
import { MobileNav } from "@/components/MobileNav";
import { HeaderModeControls } from "@/components/trading/HeaderModeControls";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "BorsaRobot — AI Destekli Borsa Takip Platformu",
    template: "%s | BorsaRobot",
  },
  description:
    "Borsa İstanbul hisse takibi, AI destekli haber analizi ve otomatik alım-satım platformu.",
};


export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="tr" className="dark">
      <body className="min-h-screen bg-[#0b0f17] text-gray-100 antialiased">
        <div className="flex min-h-screen flex-col">
          <header className="sticky top-0 z-40 border-b border-gray-800 bg-[#0b0f17]/90 backdrop-blur">
            <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-2 px-4 sm:px-6">
              <Link href="/" aria-label="BorsaRobot ana sayfa">
                <BrandMark />
              </Link>
              <div className="flex items-center gap-3">
                {/* Desktop nav — md ve üzeri görünür (iyileştirme 8.2). */}
                <nav
                  className="hidden items-center gap-1 md:flex"
                  aria-label="Ana gezinme"
                >
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={cn(
                        "flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-gray-300 transition-colors",
                        "hover:bg-gray-800 hover:text-white",
                      )}
                    >
                      <item.icon className="h-4 w-4" aria-hidden />
                      {item.label}
                    </Link>
                  ))}
                </nav>
                {/* Mod kontrolleri — Sanal/Canlı + Otomatik/Manuel; mobilde
                    kompakt switch olarak kalır, tek instance. */}
                <HeaderModeControls />
                {/* Mobil hamburger menü — md altında nav linkleri burada. */}
                <MobileNav />
              </div>
            </div>
          </header>
          <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-8 sm:px-6">
            {children}
          </main>
          <footer className="border-t border-gray-800 py-4">
            <div className="mx-auto max-w-7xl px-4 text-center text-xs text-gray-500 sm:px-6">
              BorsaRobot — Yatırım tavsiyesi değildir. Otomatik alım-satım kararları
              yapılandırılmış AI analizlerine dayanır.
            </div>
          </footer>
        </div>
      </body>
    </html>
  );
}
