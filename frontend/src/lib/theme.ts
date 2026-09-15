import { ColorType, CrosshairMode, type ChartOptions, type DeepPartial } from 'lightweight-charts'

export const colors = {
  background: '#0e1117',
  panel: '#151a23',
  border: '#232a36',
  text: '#c7d0dd',
  textDim: '#7c879a',
  up: '#26a69a',
  down: '#ef5350',
  accent: '#e0b64a',
} as const

export const chartOptions: DeepPartial<ChartOptions> = {
  layout: {
    background: { type: ColorType.Solid, color: colors.background },
    textColor: colors.textDim,
    attributionLogo: false,
  },
  grid: {
    vertLines: { color: '#1a212c' },
    horzLines: { color: '#1a212c' },
  },
  crosshair: {
    mode: CrosshairMode.Normal,
    vertLine: { color: colors.textDim, width: 1, style: 3, labelBackgroundColor: colors.border },
    horzLine: { color: colors.textDim, width: 1, style: 3, labelBackgroundColor: colors.border },
  },
  rightPriceScale: {
    borderColor: colors.border,
    scaleMargins: { top: 0.08, bottom: 0.26 },
  },
  timeScale: {
    borderColor: colors.border,
    timeVisible: true,
    secondsVisible: false,
    rightOffset: 4,
  },
  localization: {
    // Bars are stamped in UTC; render them in UTC too so the axis matches the data.
    timeFormatter: (time: number) =>
      new Date(time * 1000).toLocaleString('en-GB', { timeZone: 'UTC', hour12: false }),
  },
}
