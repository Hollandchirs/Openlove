'use client'

import { useEffect, useState, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { TrendCharts } from '@/components/trend-charts'

// ── Types ───────────────────────────────────────────────────────────────

interface MetricsData {
  heartbeat: number
  closeness: number
  trust: number
  familiarity: number
  stage: string
  totalMessages: number
  totalDays: number
  currentStreak: number
  longestStreak: number
  lastInteraction: number
  messagesPerDay: number
  memoryHitRate: number | null
  recentMemories: string[]
  trendData: Array<{ date: string; closeness: number; trust: number; familiarity: number }>
  dailyMessages: Array<{ date: string; count: number }>
  heatmap: Array<{ day: number; hour: number; count: number }>
  noData?: boolean
}

const STAGE_ORDER = ['stranger', 'acquaintance', 'friend', 'close_friend', 'intimate'] as const

const STAGE_LABELS: Record<string, string> = {
  stranger: 'Stranger',
  acquaintance: 'Acquaintance',
  friend: 'Friend',
  close_friend: 'Close Friend',
  intimate: 'Intimate',
}

const STAGE_LABELS_CN: Record<string, string> = {
  stranger: '陌生人',
  acquaintance: '认识',
  friend: '朋友',
  close_friend: '密友',
  intimate: '挚爱',
}

// ── Animated Number ─────────────────────────────────────────────────────

function AnimatedNumber({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [displayed, setDisplayed] = useState(0)
  const ref = useRef<number | null>(null)

  useEffect(() => {
    const start = displayed
    const diff = value - start
    if (Math.abs(diff) < 0.01) {
      setDisplayed(value)
      return
    }

    const duration = 800
    const startTime = performance.now()

    function tick(now: number) {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      // ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplayed(start + diff * eased)

      if (progress < 1) {
        ref.current = requestAnimationFrame(tick)
      }
    }

    ref.current = requestAnimationFrame(tick)
    return () => {
      if (ref.current) cancelAnimationFrame(ref.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  return (
    <span className="tabular-nums">
      {Math.round(displayed)}
      {suffix}
    </span>
  )
}

// ── Circular Progress ───────────────────────────────────────────────────

function HeartbeatCircle({ value }: { value: number }) {
  const pct = Math.round(value * 100)
  const radius = 72
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (pct / 100) * circumference

  return (
    <div className="relative flex items-center justify-center">
      {/* Glow background */}
      <div
        className="absolute inset-0 rounded-full opacity-20 blur-2xl"
        style={{
          background: `radial-gradient(circle, hsl(330, 80%, 60%) 0%, transparent 70%)`,
        }}
      />

      <svg width="180" height="180" className="transform -rotate-90">
        {/* Track */}
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="hsl(217, 33%, 17%)"
          strokeWidth="8"
        />
        {/* Gradient definition */}
        <defs>
          <linearGradient id="heartbeat-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="hsl(330, 80%, 60%)" />
            <stop offset="50%" stopColor="hsl(350, 90%, 65%)" />
            <stop offset="100%" stopColor="hsl(20, 90%, 60%)" />
          </linearGradient>
        </defs>
        {/* Progress */}
        <circle
          cx="90"
          cy="90"
          r={radius}
          fill="none"
          stroke="url(#heartbeat-gradient)"
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          className="transition-all duration-1000 ease-out"
          style={{
            filter: 'drop-shadow(0 0 8px hsl(330, 80%, 60%))',
          }}
        />
      </svg>

      {/* Center text */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="text-xs font-medium text-muted-foreground tracking-wider uppercase mb-1">
          Heartbeat
        </span>
        <span className="text-4xl font-bold text-foreground">
          <AnimatedNumber value={pct} />
        </span>
        <span className="text-xs text-muted-foreground mt-0.5">
          心动值
        </span>
      </div>
    </div>
  )
}

// ── Gradient Progress Bar ───────────────────────────────────────────────

function GradientProgressBar({
  label,
  value,
  gradient,
}: {
  label: string
  value: number
  gradient: string
}) {
  const pct = Math.round(value * 100)

  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-semibold text-foreground">
          <AnimatedNumber value={pct} suffix="%" />
        </span>
      </div>
      <div className="h-2.5 rounded-full bg-secondary overflow-hidden relative">
        <div
          className="h-full rounded-full transition-all duration-1000 ease-out relative"
          style={{
            width: `${pct}%`,
            background: gradient,
          }}
        >
          {/* Glow effect on the bar */}
          <div
            className="absolute inset-0 rounded-full opacity-50 blur-sm"
            style={{ background: gradient }}
          />
        </div>
      </div>
    </div>
  )
}

// ── Stage Progress Tracker ──────────────────────────────────────────────

function StageTracker({ current }: { current: string }) {
  const currentIdx = STAGE_ORDER.indexOf(current as typeof STAGE_ORDER[number])
  const safeIdx = currentIdx === -1 ? 0 : currentIdx

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1">
        {STAGE_ORDER.map((stage, idx) => {
          const isActive = idx <= safeIdx
          const isCurrent = idx === safeIdx

          return (
            <div key={stage} className="flex items-center flex-1">
              {/* Dot */}
              <div className="relative flex items-center justify-center">
                <div
                  className={`h-3.5 w-3.5 rounded-full transition-all duration-500 ${
                    isCurrent
                      ? 'bg-[hsl(330,80%,60%)] shadow-[0_0_12px_hsl(330,80%,60%)]'
                      : isActive
                        ? 'bg-[hsl(330,80%,60%)]'
                        : 'bg-secondary'
                  }`}
                />
                {isCurrent && (
                  <div className="absolute inset-0 h-3.5 w-3.5 rounded-full bg-[hsl(330,80%,60%)] animate-ping opacity-30" />
                )}
              </div>

              {/* Connector line */}
              {idx < STAGE_ORDER.length - 1 && (
                <div
                  className={`h-0.5 flex-1 mx-1 rounded-full transition-colors duration-500 ${
                    idx < safeIdx ? 'bg-[hsl(330,80%,60%)]' : 'bg-secondary'
                  }`}
                />
              )}
            </div>
          )
        })}
      </div>

      {/* Labels */}
      <div className="flex justify-between">
        {STAGE_ORDER.map((stage, idx) => {
          const isCurrent = idx === safeIdx
          return (
            <div
              key={stage}
              className={`text-center flex-1 ${
                isCurrent ? 'text-foreground' : 'text-muted-foreground'
              }`}
            >
              <span className={`text-[10px] leading-tight block ${isCurrent ? 'font-semibold' : ''}`}>
                {STAGE_LABELS[stage]}
              </span>
              <span className="text-[9px] text-muted-foreground/60 block">
                {STAGE_LABELS_CN[stage]}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main Dashboard ──────────────────────────────────────────────────────

interface MetricsDashboardProps {
  slug: string
}

export default function MetricsDashboard({ slug }: MetricsDashboardProps) {
  const [data, setData] = useState<MetricsData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/metrics/${slug}`)
      .then((res) => {
        if (!res.ok) throw new Error('Failed to load metrics')
        return res.json()
      })
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false))
  }, [slug])

  if (loading) {
    return (
      <div className="space-y-6">
        {/* Skeleton heartbeat */}
        <Card className="border-border bg-card">
          <CardContent className="p-8 flex justify-center">
            <div className="w-[180px] h-[180px] rounded-full bg-secondary animate-pulse" />
          </CardContent>
        </Card>
        {/* Skeleton bars */}
        <Card className="border-border bg-card">
          <CardContent className="p-6 space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-2">
                <div className="h-3 w-20 bg-secondary rounded animate-pulse" />
                <div className="h-2.5 w-full bg-secondary rounded-full animate-pulse" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error || !data || data.noData) {
    return (
      <Card className="border-border bg-card">
        <CardContent className="p-8 text-center">
          <div className="mb-3 text-3xl">&#x1F49C;</div>
          <p className="text-sm font-medium text-foreground">No data yet</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Start a conversation to see your relationship grow!
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-6">
      {/* Heartbeat Score */}
      <Card className="border-border bg-card overflow-hidden relative">
        <div
          className="absolute inset-0 opacity-5"
          style={{
            background: 'radial-gradient(ellipse at center, hsl(330, 80%, 60%), transparent 70%)',
          }}
        />
        <CardContent className="p-8 flex justify-center relative z-10">
          <HeartbeatCircle value={data.heartbeat} />
        </CardContent>
      </Card>

      {/* Relationship Metrics */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Relationship Metrics</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <GradientProgressBar
            label="Closeness"
            value={data.closeness}
            gradient="linear-gradient(90deg, hsl(330, 80%, 50%), hsl(350, 90%, 65%))"
          />
          <GradientProgressBar
            label="Trust"
            value={data.trust}
            gradient="linear-gradient(90deg, hsl(210, 70%, 50%), hsl(230, 80%, 65%))"
          />
          <GradientProgressBar
            label="Familiarity"
            value={data.familiarity}
            gradient="linear-gradient(90deg, hsl(150, 50%, 40%), hsl(170, 60%, 55%))"
          />
        </CardContent>
      </Card>

      {/* Stage Progress */}
      <Card className="border-border bg-card">
        <CardHeader className="pb-2">
          <CardTitle className="text-base font-semibold">Stage Progress</CardTitle>
        </CardHeader>
        <CardContent>
          <StageTracker current={data.stage} />
        </CardContent>
      </Card>

      {/* Stats Grid */}
      <div className="grid grid-cols-2 gap-3">
        {/* Messages/Day */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {data.messagesPerDay.toFixed(1)}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">msgs/day (avg)</p>
          </CardContent>
        </Card>

        {/* Total Messages */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              <AnimatedNumber value={data.totalMessages} />
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">total messages</p>
          </CardContent>
        </Card>

        {/* Current Streak */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {data.currentStreak > 0 && (
                <span className="mr-1 text-lg">🔥</span>
              )}
              <AnimatedNumber value={data.currentStreak} />
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">day streak</p>
          </CardContent>
        </Card>

        {/* Longest Streak */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {data.longestStreak > 0 && (
                <span className="mr-1 text-lg">🔥</span>
              )}
              <AnimatedNumber value={data.longestStreak} />
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">longest streak</p>
          </CardContent>
        </Card>

        {/* Days Together */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              <AnimatedNumber value={data.totalDays} />
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">days together</p>
          </CardContent>
        </Card>

        {/* Memory Hit Rate */}
        <Card className="border-border bg-card">
          <CardContent className="p-4 text-center">
            <p className="text-2xl font-bold text-foreground">
              {data.memoryHitRate !== null ? (
                <AnimatedNumber value={Math.round(data.memoryHitRate * 100)} suffix="%" />
              ) : (
                <span className="text-muted-foreground text-base">--</span>
              )}
            </p>
            <p className="text-[11px] text-muted-foreground mt-0.5">memory hit rate</p>
          </CardContent>
        </Card>
      </div>

      {/* Recent Memories */}
      {data.recentMemories.length > 0 && (
        <Card className="border-border bg-card">
          <CardHeader className="pb-2">
            <CardTitle className="text-base font-semibold">Recent Memories</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2">
              {data.recentMemories.map((memory, i) => (
                <li key={i} className="flex items-start gap-2.5 text-sm">
                  <span className="mt-1.5 w-1.5 h-1.5 rounded-full bg-[hsl(330,80%,60%)] shrink-0" />
                  <span className="text-muted-foreground leading-relaxed">{memory}</span>
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}

      {/* Trend Charts */}
      <TrendCharts
        trendData={data.trendData}
        dailyMessages={data.dailyMessages}
        heatmap={data.heatmap}
      />
    </div>
  )
}
