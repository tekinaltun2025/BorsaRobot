"use client";

import { useEffect, useRef, useState } from "react";
import {
  AreaSeries,
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import type { ChartCandle } from "@/lib/types";

/**
 * Fiyat grafiği — TradingView Lightweight Charts v5.
 *
 * v5 API sözleşmesi (v4'ten farkı):
 *  - Seri ekleme: chart.addSeries(CandlestickSeries, options) —
 *    v4'teki chart.addCandlestickSeries() KALDIRILDI.
 *  - Seri tanımları (CandlestickSeries, AreaSeries, LineSeries...) modül
 *    sabitleri olarak export edilir.
 *
 * Davranış sözleşmesi:
 *  - Responsive: ResizeObserver ile container'ı izler; unmount'ta
 *    disconnect + chart.remove() (memory leak yok).
 *  - Dönem değişince (range) veri yeniden set edilir; chart instance'ı
 *    korunur (gereksiz yeniden yaratma yok).
 *  - Crosshair tooltip: subscribeCrosshairMove ile mum bilgisi (O/H/L/C)
 *    üst başlıkta gösterilir; unmount'ta unsubscribe.
 *  - Chart tipi: ≥2 mum ve OHLC farkı varsa candlestick, tek nokta/düz
 *    seride area (tek fiyat noktası candlestick'te görünmez).
 */

export type ChartType = "candlestick" | "area";

/** Crosshair'de gösterilen mum özeti. */
export interface HoveredCandle {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
}

const DARK_CHART_OPTIONS = {
  layout: {
    background: { color: "transparent" },
    textColor: "#9ca3af",
    fontSize: 11,
  },
  grid: {
    vertLines: { color: "rgba(75, 85, 99, 0.15)" },
    horzLines: { color: "rgba(75, 85, 99, 0.15)" },
  },
  crosshair: {
    vertLine: { color: "#6b7280", width: 1 as const, style: 2 as const },
    horzLine: { color: "#6b7280", width: 1 as const, style: 2 as const },
  },
  rightPriceScale: { borderColor: "#374151" },
  timeScale: {
    borderColor: "#374151",
    timeVisible: true,
    secondsVisible: false,
  },
} as const;

export function PriceChart({
  candles,
  chartType,
  onHover,
}: {
  candles: ChartCandle[];
  /** candlestick | area — veri şekline göre üst bileşen seçer. */
  chartType: ChartType;
  /** Crosshair mum seçimi callback'i (tooltip üst bileşeninde). */
  onHover?: (candle: HoveredCandle | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick" | "Area"> | null>(null);
  const hoverRef = useRef(onHover);

  // onHover ref'i her render'da tazelenir; chart handler'ı sabit kalır.
  useEffect(() => {
    hoverRef.current = onHover;
  }, [onHover]);

  // Chart instance'ı bir kez oluşturulur; resize observer bağlanır.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      ...DARK_CHART_OPTIONS,
      width: container.clientWidth,
      height: container.clientHeight,
    });
    chartRef.current = chart;

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) {
        chart.applyOptions({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  // Seri: chartType değişince eski seri kaldırılır, yenisi eklenir.
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    // Eski seriyi kaldır (range/chartType geçişinde tek seri kuralı).
    if (seriesRef.current) {
      chart.removeSeries(seriesRef.current);
      seriesRef.current = null;
    }

    if (chartType === "candlestick") {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#10b981",
        downColor: "#f43f5e",
        borderUpColor: "#10b981",
        borderDownColor: "#f43f5e",
        wickUpColor: "#10b981",
        wickDownColor: "#f43f5e",
      });
      seriesRef.current = series;
    } else {
      const series = chart.addSeries(AreaSeries, {
        lineColor: "#3b82f6",
        topColor: "rgba(59, 130, 246, 0.28)",
        bottomColor: "rgba(59, 130, 246, 0.02)",
        lineWidth: 2,
      });
      seriesRef.current = series;
    }

    // Crosshair tooltip — mum bilgisi üst bileşene taşınır.
    const handleCrosshair = (param: MouseEventParams<Time>): void => {
      if (
        !param.time ||
        !hoverRef.current ||
        !seriesRef.current
      ) {
        hoverRef.current?.(null);
        return;
      }
      const bar = param.seriesData.get(
        seriesRef.current,
      ) as CandlestickData<Time> | undefined;
      if (
        !bar ||
        typeof bar.open !== "number" ||
        typeof bar.high !== "number" ||
        typeof bar.low !== "number" ||
        typeof bar.close !== "number"
      ) {
        hoverRef.current?.(null);
        return;
      }
      hoverRef.current({
        time: param.time as UTCTimestamp,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
      });
    };
    chart.subscribeCrosshairMove(handleCrosshair);

    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      if (seriesRef.current) {
        chart.removeSeries(seriesRef.current);
        seriesRef.current = null;
      }
    };
  }, [chartType]);

  // Veri: candles değişince setData; chartType'a göre şekillendirilir.
  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    if (series.seriesType() === "Candlestick") {
      const data: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }));
      (series as ISeriesApi<"Candlestick">).setData(data);
    } else {
      const data = candles.map((c) => ({
        time: c.time as UTCTimestamp,
        value: c.close,
      }));
      (series as ISeriesApi<"Area">).setData(data);
    }

    chartRef.current?.timeScale().fitContent();
  }, [candles, chartType]);

  return (
    <div
      ref={containerRef}
      className="h-[420px] w-full"
      role="img"
      aria-label="Fiyat grafiği"
    />
  );
}
