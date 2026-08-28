// Indicatore del drago: cresce a ogni query eseguita (0-100).
// Il drago è piccolo all'inizio e diventa grande a 100 query.
export default function DragonMeter({ level }: { level: number }) {
  const pct = Math.min(100, Math.max(0, level))
  const size = 14 + pct * 1.1 // 14px → 124px a 100
  const big = pct >= 100
  return (
    <div
      className="flex shrink-0 items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 px-2 py-1"
      title={`Il drago cresce a ogni query eseguita (${pct}/100). A 100 è grande!`}
    >
      <span
        className={`inline-block leading-none transition-all duration-700 ${big ? 'dragon-big' : ''}`}
        style={{
          fontSize: `${size}px`,
          filter: big
            ? 'drop-shadow(0 0 14px rgba(251,113,133,0.95))'
            : pct > 50
              ? 'drop-shadow(0 0 7px rgba(251,146,60,0.65))'
              : pct > 10
                ? 'drop-shadow(0 0 4px rgba(251,191,36,0.45))'
                : undefined,
        }}
      >
        🐉
      </span>
      <div className="hidden w-24 sm:block">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
          <div
            className="h-full rounded-full bg-gradient-to-r from-amber-500 via-orange-500 to-rose-500 transition-all duration-500"
            style={{ width: `${pct}%` }}
          />
        </div>
        <div className="mt-0.5 text-right text-[10px] tabular-nums text-zinc-500">
          {big ? '💥 DRAGO MAX' : `Drago ${pct}/100`}
        </div>
      </div>
    </div>
  )
}
