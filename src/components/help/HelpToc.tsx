"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Yardım sayfası sticky içindekiler (TOC) navigasyonu.
 *
 * IntersectionObserver ile `[data-toc-id]` başlıklarını izler; görünür
 * bölüme göre aktif öğeyi vurgular. Masaüstünde sol kolonda sticky,
 * mobilde gizlidir (`hidden lg:block`).
 */

/** İçindekiler öğesi — alt öğeli olabilir. */
interface TocEntry {
  id: string;
  label: string;
  children?: TocEntry[];
}

const TOC_ENTRIES: TocEntry[] = [
  { id: "genel-bakis", label: "Sistem Genel Bakış" },
  {
    id: "ekran-rehberi",
    label: "Ekran Rehberi",
    children: [
      { id: "ekran-panel", label: "Ana Sayfa (/)" },
      { id: "ekran-watchlist", label: "İzleme Listesi" },
      { id: "ekran-stock", label: "Hisse Detayı" },
      { id: "ekran-trading", label: "Ticaret Paneli" },
      { id: "ekran-admin", label: "Yönetim Paneli" },
    ],
  },
  { id: "otomatik-motor", label: "Otomatik Motor Nasıl Çalışır" },
  { id: "sorunlar", label: "Sık Karşılaşılan Sorunlar" },
];

export function HelpToc() {
  const [activeId, setActiveId] = useState<string>("genel-bakis");

  useEffect(() => {
    const headings = document.querySelectorAll<HTMLElement>("[data-toc-id]");
    if (headings.length === 0) return;

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveId(entry.target.id);
          }
        }
      },
      // Header (56px) altından başlayarak üst bölgeyi hariç tutar.
      { rootMargin: "-96px 0px -65% 0px", threshold: 0 },
    );

    headings.forEach((heading) => observer.observe(heading));
    return () => observer.disconnect();
  }, []);

  return (
    <nav aria-label="Yardım sayfası içindekiler" className="hidden lg:block">
      <div className="sticky top-20">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
          İçindekiler
        </p>
        <ul className="space-y-1 border-l border-gray-800">
          {TOC_ENTRIES.map((entry) => (
            <li key={entry.id}>
              <a
                href={`#${entry.id}`}
                className={cn(
                  "-ml-px block border-l-2 py-1 pl-3 text-sm transition-colors",
                  activeId === entry.id
                    ? "border-blue-500 font-medium text-blue-400"
                    : "border-transparent text-gray-400 hover:border-gray-600 hover:text-gray-200",
                )}
              >
                {entry.label}
              </a>
              {entry.children ? (
                <ul className="space-y-1">
                  {entry.children.map((child) => (
                    <li key={child.id}>
                      <a
                        href={`#${child.id}`}
                        className={cn(
                          "-ml-px block border-l-2 py-1 pl-6 text-xs transition-colors",
                          activeId === child.id
                            ? "border-blue-500 font-medium text-blue-400"
                            : "border-transparent text-gray-500 hover:border-gray-600 hover:text-gray-300",
                        )}
                      >
                        {child.label}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
