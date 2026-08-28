// Drago di sfondo: immagine trasparente in basso a destra che cresce a ogni query
// eseguita (0-100). Non interagisce con il mouse (pointer-events-none).
export default function DragonBackground({ level }: { level: number }) {
  const pct = Math.min(100, Math.max(0, level))
  const size = 40 + pct * 2.6 // 40px → 300px a 100
  const opacity = 0.05 + (pct / 100) * 0.45 // quasi invisibile → ben visibile
  const big = pct >= 100
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className={`absolute bottom-2 right-4 select-none leading-none transition-all duration-1000 ${
          big ? 'dragon-big' : ''
        }`}
        style={{
          fontSize: `${size}px`,
          opacity,
          filter: big
            ? 'drop-shadow(0 0 40px rgba(251,113,133,0.8)) drop-shadow(0 0 90px rgba(251,146,60,0.5))'
            : pct > 50
              ? 'drop-shadow(0 0 24px rgba(251,146,60,0.5))'
              : pct > 10
                ? 'drop-shadow(0 0 12px rgba(251,191,36,0.35))'
                : undefined,
        }}
      >
        🐉
      </div>
    </div>
  )
}
