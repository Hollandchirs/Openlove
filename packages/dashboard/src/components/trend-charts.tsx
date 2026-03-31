'use client'

import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// ── Types ───────────────────────────────────────────────────────────────

interface TrendPoint {
  date: string
  closeness: number
  trust: number
  familiarity: number
}

interface DailyMessagePoint {
  date: string
  count: number
}

interface HeatmapCell {
  day: number
  hour: number
  count: number
}

interface TrendChartsProps {
  trendData: TrendPoint[]
  dailyMessages: DailyMessagePoint[]
  heatmap: HeatmapCell[]
}

// ── Shared styles ───────────────────────────────────────────────────────

const GRID_STROKE = 'hsl(217, 33%, 17%)'
const AXIS_TICK = { fontSize: 11, fill: 'hsl(215, 20%, 65%)' }

// ── Custom Tooltip ──────────────────────────────────────────────────────

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ name: string; value: number; color: string }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="text-xs font-medium text-foreground mb-2">{label}</p>
      {payload.map((item) => (
        <div key={item.name} className="flex items-center gap-2 text-xs">
          <div
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          <span className="text-muted-foreground capitalize">{item.name}:</span>
          <span className="font-medium text-foreground">{item.value}%</span>
        </div>
      ))}
    </div>
  )
}

function BarTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: Array<{ value: number }>
  label?: string
}) {
  if (!active || !payload || payload.length === 0) return null

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-lg">
      <p className="text-xs font-medium text-foreground mb-1">{label}</p>
      <p className="text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{payload[0].value}</span> messages
      </p>
    </div>
  )
}

// ── Heatmap ─────────────────────────────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function ActivityHeatmap({ data }: { data: HeatmapCell[] }) {
  if (data.length === 0) return null

  const maxCount = Math.max(...data.map((c) => c.count), 1)

  function getColor(count: number): string {
    if (count === 0) return 'hsl(217, 33%, 12%)'
    const intensity = count / maxCount
    if (intensity < 0.25) return 'hsl(330, 40%, 20%)'
    if (intensity < 0.5) return 'hsl(330, 60%, 30%)'
    if (intensity < 0.75) return 'hsl(330, 70%, 42%)'
    return 'hsl(330, 80%, 55%)'
  }

  // Show hours in 3-hour intervals for labels
  const hourLabels = Array.from({ length: 8 }, (_, i) => {
    const h = i * 3
    return h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`
  })

  return (
    <div className="space-y-3">
      {/* Hour labels */}
      <div className="flex items-end ml-10">
        {hourLabels.map((label, i) => (
          <span
            key={i}
            className="text-[9px] text-muted-foreground/60"
            style={{ width: `${(3 / 24) * 100}%` }}
          >
            {label}
          </span>
        ))}
      </div>

      {/* Grid */}
      <div className="space-y-1">
        {DAY_LABELS.map((dayLabel, dayIdx) => (
          <div key={dayIdx} className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
              {dayLabel}
            </span>
            <div className="flex flex-1 gap-[2px]">
              {Array.from({ length: 24 }, (_, hourIdx) => {
                const cell = data.find((c) => c.day === dayIdx && c.hour === hourIdx)
                const count = cell?.count ?? 0
                return (
                  <div
                    key={hourIdx}
                    className="flex-1 aspect-square rounded-sm transition-colors"
                    style={{ backgroundColor: getColor(count) }}
                    title={`${dayLabel} ${hourIdx}:00 - ${count} messages`}
                  />
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-end gap-1.5">
        <span className="text-[9px] text-muted-foreground/60">Less</span>
        {[0, 0.25, 0.5, 0.75, 1].map((intensity) => (
          <div
            key={intensity}
            className="w-3 h-3 rounded-sm"
            style={{
              backgroundColor: getColor(Math.round(intensity * maxCount)),
            }}
          />
        ))}
        <span className="text-[9px] text-muted-foreground/60">More</span>
      </div>
    </div>
  )
}

// ── Format date for chart labels ────────────────────────────────────────

function formatShortDate(dateStr: string): string {
  const parts = dateStr.split('-')
  if (parts.length !== 3) return dateStr
  return `${parseInt(parts[1])}/${parseInt(parts[2])}`
}

// ── Main Component ──────────────────────────────────────────────────────

export function TrendCharts({ trendData, dailyMessages, heatmap }: TrendChartsProps) {
  const hasTrend = trendData.length >= 2
  const hasMessages = dailyMessages.some((d) => d.count > 0)
  const hasHeatmap = heatmap.some((c) => c.count > 0)

  if (!hasTrend && !hasMessages && !hasHeatmap) {
    return null
  }

  return (
    <div className="space-y-6">
      {/* 30-Day Trend */}
      {hasTrend && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Relationship Trend</CardTitle>
              <span className="text-xs text-muted-foreground">Last 30 days</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[260px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart
                  data={trendData}
                  margin={{ top: 5, right: 5, bottom: 5, left: -15 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID_STROKE}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={{ stroke: GRID_STROKE }}
                    tickFormatter={formatShortDate}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    domain={[0, 100]}
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(v: number) => `${v}%`}
                  />
                  <Tooltip content={<ChartTooltip />} />
                  <Legend
                    wrapperStyle={{ fontSize: '11px', paddingTop: '8px' }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Line
                    type="monotone"
                    dataKey="closeness"
                    stroke="hsl(330, 80%, 60%)"
                    strokeWidth={2.5}
                    dot={{ r: 2, fill: 'hsl(330, 80%, 60%)' }}
                    activeDot={{ r: 5, strokeWidth: 0 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="trust"
                    stroke="hsl(210, 80%, 60%)"
                    strokeWidth={2.5}
                    dot={{ r: 2, fill: 'hsl(210, 80%, 60%)' }}
                    activeDot={{ r: 5, strokeWidth: 0 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="familiarity"
                    stroke="hsl(150, 60%, 50%)"
                    strokeWidth={2.5}
                    dot={{ r: 2, fill: 'hsl(150, 60%, 50%)' }}
                    activeDot={{ r: 5, strokeWidth: 0 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Daily Message Count */}
      {hasMessages && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Daily Messages</CardTitle>
              <span className="text-xs text-muted-foreground">Last 14 days</span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[200px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={dailyMessages}
                  margin={{ top: 5, right: 5, bottom: 5, left: -15 }}
                >
                  <CartesianGrid
                    strokeDasharray="3 3"
                    stroke={GRID_STROKE}
                    vertical={false}
                  />
                  <XAxis
                    dataKey="date"
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={{ stroke: GRID_STROKE }}
                    tickFormatter={formatShortDate}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={AXIS_TICK}
                    tickLine={false}
                    axisLine={false}
                    allowDecimals={false}
                  />
                  <Tooltip content={<BarTooltip />} />
                  <defs>
                    <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(330, 80%, 60%)" stopOpacity={1} />
                      <stop offset="100%" stopColor="hsl(330, 80%, 40%)" stopOpacity={0.8} />
                    </linearGradient>
                  </defs>
                  <Bar
                    dataKey="count"
                    fill="url(#barGradient)"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={32}
                  />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Activity Heatmap */}
      {hasHeatmap && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base font-semibold">Activity Heatmap</CardTitle>
              <span className="text-xs text-muted-foreground">When you chat most</span>
            </div>
          </CardHeader>
          <CardContent>
            <ActivityHeatmap data={heatmap} />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
