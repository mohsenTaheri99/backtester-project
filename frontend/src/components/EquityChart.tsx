import { useEffect, useRef } from "react";
import {
  AreaSeries,
  ColorType,
  createChart,
  type AreaData,
  type IChartApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { colors } from "../lib/theme";
import type { EquityPoint } from "../types";

interface Props {
  equity: EquityPoint[];
  startingCash: number;
}

export default function EquityChart({ equity, startingCash }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ReturnType<IChartApi["addSeries"]> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: colors.textDim,
        attributionLogo: false,
      },
      grid: { vertLines: { visible: false }, horzLines: { color: "#1a212c" } },
      rightPriceScale: {
        borderVisible: false,
        scaleMargins: { top: 0.15, bottom: 0.05 },
      },
      timeScale: { borderVisible: false, timeVisible: false },
      handleScale: false,
      handleScroll: false,
      crosshair: {
        horzLine: { visible: false },
        vertLine: { labelVisible: false },
      },
    });

    seriesRef.current = chart.addSeries(AreaSeries, {
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
    });
    chartRef.current = chart;

    const observer = new ResizeObserver(([entry]) => {
      chart.applyOptions({
        width: Math.floor(entry.contentRect.width),
        height: Math.floor(entry.contentRect.height),
      });
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const final = equity.length
      ? equity[equity.length - 1].equity
      : startingCash;
    const up = final >= startingCash;
    series.applyOptions({
      lineColor: up ? colors.up : colors.down,
      topColor: up ? `${colors.up}55` : `${colors.down}55`,
      bottomColor: up ? `${colors.up}05` : `${colors.down}05`,
    });

    const data: AreaData<UTCTimestamp>[] = equity.map((point) => ({
      time: point.time as UTCTimestamp,
      value: point.equity,
    }));
    series.setData(data);
    chartRef.current?.timeScale().fitContent();
  }, [equity, startingCash]);

  return <div className="equity-chart" ref={containerRef} />;
}
