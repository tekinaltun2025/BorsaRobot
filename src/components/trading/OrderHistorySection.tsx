"use client";

import { useCallback, useEffect, useState } from "react";
import { OrderHistoryTable } from "@/components/trading/OrderHistoryTable";
import type { PlaceOrderResult } from "@/server/services/trading-service";

type OrderListResponse = {
  orders: PlaceOrderResult["order"][];
  total: number;
  page: number;
  pageSize: number;
};

/**
 * Emir geçmişi bölümü — sayfalama etkileşimi client-side fetch ile.
 * refreshKey değiştiğinde (yeni emir verildiğinde) listeyi yeniden çeker.
 */
export function OrderHistorySection({ refreshKey }: { refreshKey: number }) {
  const [data, setData] = useState<OrderListResponse | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (targetPage: number) => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/trading/order?page=${targetPage}&pageSize=10`,
          { cache: "no-store" },
        );
        if (!response.ok) {
          const body: unknown = await response.json().catch(() => null);
          const message =
            typeof body === "object" && body !== null && "error" in body
              ? String((body as { error: unknown }).error)
              : "Emir geçmişi yüklenemedi.";
          setError(message);
          return;
        }
        setData((await response.json()) as OrderListResponse);
      } catch {
        setError("Sunucuya ulaşılamadı; emir geçmişi yenilenemedi.");
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    void load(page);
  }, [load, page, refreshKey]);

  if (error) {
    return (
      <div
        role="alert"
        className="rounded-xl border border-rose-800 bg-rose-950/40 p-4 text-sm text-rose-200"
      >
        {error}
      </div>
    );
  }

  if (loading && data === null) {
    return (
      <div className="rounded-xl border border-gray-800 bg-gray-900/40 p-8 text-center text-sm text-gray-500">
        Emir geçmişi yükleniyor...
      </div>
    );
  }

  if (!data) return null;

  return (
    <OrderHistoryTable
      orders={data.orders}
      total={data.total}
      page={data.page}
      pageSize={data.pageSize}
      onPageChange={setPage}
    />
  );
}
