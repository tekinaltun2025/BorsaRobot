import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Yardım sayfası ortak UI primitifleri — bölüm, alt bölüm, tablo, adım
 * listesi, bilgi kutusu, akış diyagramı ve ekran görüntüsü çerçevesi.
 * Tümü dark tema tasarım diliyle (gray-800/900/950 + blue vurgu) uyumludur.
 */

/** Ana bölüm — TOC ile `data-toc-id` üzerinden eşleşir. */
export function HelpSection({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section id={id} data-toc-id={id} className="scroll-mt-20 space-y-5">
      <div>
        <h2 className="text-2xl font-bold tracking-tight">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-3xl text-sm leading-relaxed text-gray-400">
            {description}
          </p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

/** Alt bölüm — h3 başlıklı; opsiyonel route rozeti gösterir. */
export function SubSection({
  id,
  title,
  route,
  children,
}: {
  id: string;
  title: string;
  route?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} data-toc-id={id} className="scroll-mt-20 space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <h3 className="text-lg font-semibold">{title}</h3>
        {route ? (
          <code className="rounded bg-gray-800 px-2 py-0.5 text-xs font-medium text-blue-300">
            {route}
          </code>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/** İçerik kartı — opsiyonel başlıklı gruplayıcı. */
export function HelpCard({
  title,
  children,
}: {
  title?: string;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-5">
      {title ? (
        <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          {title}
        </h4>
      ) : null}
      {children}
    </div>
  );
}

/** Alan açıklama tablosu — ilk sütun alan/kart adı, ikinci sütun açıklama. */
export function InfoTable({
  headers,
  rows,
}: {
  headers: string[];
  rows: ReactNode[][];
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full min-w-[560px] text-sm">
        <thead>
          <tr className="border-b border-gray-800 bg-gray-900/80 text-left text-xs uppercase tracking-wide text-gray-400">
            {headers.map((header) => (
              <th key={header} className="px-4 py-3 font-medium">
                {header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={rowIndex}
              className="border-b border-gray-800/60 last:border-0"
            >
              {row.map((cell, cellIndex) => (
                <td
                  key={cellIndex}
                  className={cn(
                    "px-4 py-3 align-top leading-relaxed",
                    cellIndex === 0
                      ? "font-medium text-gray-200"
                      : "text-gray-400",
                  )}
                >
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Numaralı adım listesi — döngü/akış anlatımı için. */
export function StepList({ items }: { items: ReactNode[] }) {
  return (
    <ol className="space-y-3">
      {items.map((item, index) => (
        <li key={index} className="flex gap-3">
          <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-600/20 text-xs font-semibold text-blue-300">
            {index + 1}
          </span>
          <div className="pt-0.5 text-sm leading-relaxed text-gray-300">
            {item}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** Bilgi/uyarı kutusu — info/warning/danger/success tonları. */
export function Callout({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: "border-blue-900/50 bg-blue-950/30 text-blue-200",
    warning: "border-amber-800 bg-amber-950/40 text-amber-200",
    danger: "border-rose-800 bg-rose-950/40 text-rose-200",
    success: "border-emerald-800 bg-emerald-950/40 text-emerald-200",
  } as const;

  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone])}>
      {title ? <p className="font-semibold">{title}</p> : null}
      <div className={cn("leading-relaxed", title && "mt-1")}>{children}</div>
    </div>
  );
}

/** Uçtan uca akış diyagramı — dikey adım zinciri. */
export function FlowDiagram({ steps }: { steps: string[] }) {
  return (
    <div className="space-y-0 rounded-xl border border-gray-800 bg-gray-950/60 p-5">
      {steps.map((step, index) => (
        <div key={index}>
          <div className="rounded-lg border border-gray-800 bg-gray-900/80 px-4 py-2.5 text-sm text-gray-200">
            {step}
          </div>
          {index < steps.length - 1 ? (
            <div
              className="flex justify-center py-1 text-lg leading-none text-gray-600"
              aria-hidden
            >
              ↓
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

/** Ekran görüntüsü çerçevesi — dark temada kenarlıklı, altyazılı. */
export function Screenshot({
  src,
  alt,
  caption,
}: {
  src: string;
  alt: string;
  caption?: string;
}) {
  return (
    <figure className="overflow-hidden rounded-xl border border-gray-800 bg-gray-950 shadow-lg">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} loading="lazy" className="w-full" />
      {caption ? (
        <figcaption className="border-t border-gray-800 bg-gray-900/60 px-4 py-2.5 text-xs text-gray-500">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  );
}
