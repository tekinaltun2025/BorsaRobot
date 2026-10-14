"use client";

import { useState, useEffect } from "react";
import {
  CheckCircle2,
  XCircle,
  Clock,
  ArrowUpRight,
  ArrowDownLeft,
  DollarSign
} from "lucide-react";
import { cn } from "@/lib/utils";
import { inputClass } from "@/components/admin/shared";
import {
  EmptyState,
  ErrorState,
  Skeleton
} from "@/components/ui/states";
import type { PendingOrderView } from "@/lib/types";

export function PendingOrdersSection() {
  const [orders, setOrders] = useState<PendingOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectionReason, setRejectionReason] = useState("");
  const [feedback, setFeedback] = useState<{ type: "success" | "error"; message: string } | null>(null);

  const fetchOrders = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await fetch("/api/admin/orders/pending");
      if (!response.ok) throw new Error("Bekleyen emirler yüklenemedi.");
      const data = await response.json();
      setOrders(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bir hata oluştu.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOrders();
  }, []);

  const showFeedback = (type: "success" | "error", message: string) => {
    setFeedback({ type, message });
    window.setTimeout(() => setFeedback(null), 3000);
  };

  const handleApprove = async (id: string) => {
    try {
      const response = await fetch(`/api/admin/orders/${id}/approve`, {
        method: "POST",
      });
      if (!response.ok) throw new Error("Onaylama işlemi başarısız oldu.");
      showFeedback("success", "Emir onaylandı.");
      fetchOrders();
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Hata oluştu.");
    }
  };

  const handleReject = async () => {
    if (!rejectionReason.trim()) return;
    const id = rejectingId;
    if (!id) return;

    try {
      const response = await fetch(`/api/admin/orders/${id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: rejectionReason }),
      });
      if (!response.ok) throw new Error("Reddetme işlemi başarısız oldu.");
      showFeedback("success", "Emir reddedildi.");
      setRejectingId(null);
      setRejectionReason("");
      fetchOrders();
    } catch (err) {
      showFeedback("error", err instanceof Error ? err.message : "Hata oluştu.");
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5 text-yellow-500" />
          Onay Bekleyen Emirler
        </h2>
        <div className="space-y-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState 
        title="Emirler Yüklenemedi" 
        message={error} 
        action={<button onClick={fetchOrders} className="text-sm text-blue-400 underline">Tekrar Dene</button>} 
      />
    );
  }

  if (orders.length === 0) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5 text-yellow-500" />
          Onay Bekleyen Emirler
        </h2>
        <EmptyState title="Bekleyen Emir Yok" message="Şu an onay bekleyen bir işlem bulunmuyor." />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-lg font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5 text-yellow-500" />
          Onay Bekleyen Emirler ({orders.length})
        </h2>
      </header>

      {feedback && (
        <div className={cn(
          "p-3 rounded-lg text-sm animate-in fade-in slide-in-from-top-2",
          feedback.type === "success" ? "bg-emerald-950/50 text-emerald-400 border border-emerald-800/50" : "bg-red-950/50 text-red-400 border border-red-800/50"
        )}>
          {feedback.message}
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-gray-800 bg-gray-900/20">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-gray-800 bg-gray-900/40 text-xs uppercase tracking-wider text-gray-400">
            <tr>
              <th className="px-4 py-3 font-medium">Sembol</th>
              <th className="px-4 py-3 font-medium">Yön</th>
              <th className="px-4 py-3 font-medium">Miktar</th>
              <th className="px-4 py-3 font-medium text-right">Tahmini Tutar</th>
              <th className="px-4 py-3 font-medium">Zaman</th>
              <th className="px-4 py-3 font-medium text-center">İşlem</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-800/50">
            {orders.map((order) => (
              <tr key={order.id} className="hover:bg-gray-800/30 transition-colors">
                <td className="px-4 py-4 font-bold text-blue-400">{order.orderData.symbol}</td>
                <td className="px-4 py-4">
                  <div className={cn(
                    "flex items-center gap-1",
                    order.orderData.side === "BUY" ? "text-emerald-400" : "text-red-400"
                  )}>
                    {order.orderData.side === "BUY" ? <ArrowUpRight className="h-4 w-4" /> : <ArrowDownLeft className="h-4 w-4" />}
                    {order.orderData.side}
                  </div>
                </td>
                <td className="px-4 py-4">
                  {order.orderData.quantity} <span className="text-xs text-gray-500">{order.orderData.currency}</span>
                </td>
                <td className="px-4 py-4 text-right font-mono">
                  <div className="flex items-center justify-end gap-1">
                    <DollarSign className="h-3 w-3 text-gray-500" />
                    {parseFloat(order.orderData.price).toLocaleString('tr-TR', { minimumFractionDigits: 2 })}
                  </div>
                </td>
                <td className="px-4 py-4 text-xs text-gray-500">
                  {new Date(order.createdAt).toLocaleTimeString("tr-TR", { hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="px-4 py-4">
                  <div className="flex items-center justify-center gap-2">
                    <button
                      onClick={() => handleApprove(order.id)}
                      className="p-1.5 rounded-md bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all"
                      title="Onayla"
                    >
                      <CheckCircle2 className="h-4 w-4" />
                    </button>
                    <button
                      onClick={() => setRejectingId(order.id)}
                      className="p-1.5 rounded-md bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"
                      title="Reddet"
                    >
                      <XCircle className="h-4 w-4" />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Rejection Modal */}
      {rejectingId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-xl border border-gray-800 bg-gray-900 p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <h3 className="text-lg font-semibold text-white">Emri Reddet</h3>
            <p className="mt-1 text-sm text-gray-400">Lütfen reddetme nedenini belirtin.</p>
            
            <textarea
              autoFocus
              className={cn(inputClass, "mt-4 min-h-[100px] resize-none")}
              placeholder="Örn: Risk limitleri aşıldı veya sembol hatalı..."
              value={rejectionReason}
              onChange={(e) => setRejectionReason(e.target.value)}
            />

            <div className="mt-6 flex justify-end gap-3">
              <button
                onClick={() => {
                  setRejectingId(null);
                  setRejectionReason("");
                }}
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors"
              >
                İptal
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectionReason.trim()}
                className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Reddet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
