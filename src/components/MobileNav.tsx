"use client";

import { useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { navItems } from "@/lib/nav";

/**
 * Mobil hamburger menüsü (iyileştirme 8.2) — `md:` altında 6 nav öğesi +
 * mod kontrolleri ekrana sığmadığından nav linkleri bu panelde toplanır.
 * HeaderModeControls bilinçli olarak burada tekrar render EDİLMEZ:
 * bileşen client-side fetch yaptığından ikinci kopya çift istek üretirdi;
 * kompakt switch'i header'da zaten görünür kalır.
 */
export function MobileNav() {
  const [open, setOpen] = useState(false);

  return (
    <div className="md:hidden">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-controls="mobile-nav-panel"
        aria-label={open ? "Menüyü kapat" : "Menüyü aç"}
        className="flex h-9 w-9 items-center justify-center rounded-md text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
      >
        {open ? (
          <X className="h-5 w-5" aria-hidden />
        ) : (
          <Menu className="h-5 w-5" aria-hidden />
        )}
      </button>
      {open ? (
        <nav
          id="mobile-nav-panel"
          aria-label="Mobil gezinme"
          className="absolute left-0 right-0 top-14 z-50 border-b border-gray-800 bg-[#0b0f17]/95 p-4 shadow-lg backdrop-blur"
        >
          <ul className="space-y-1">
            {navItems.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-gray-300 transition-colors hover:bg-gray-800 hover:text-white"
                >
                  <item.icon className="h-4 w-4" aria-hidden />
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </div>
  );
}
