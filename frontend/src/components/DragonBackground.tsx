// Drago di sfondo: immagine trasparente in basso a destra. Resta NASCOSTO finché non
// viene evocato (query con PRINT 'drago'); compare ~8 secondi con transizione.
export default function DragonBackground({ level, visible }: { level: number; visible: boolean }) {
  const pct = Math.min(100, Math.max(0, level))
  const size = 40 + pct * 2.6 // 40px → 300px a 100
  const targetOpacity = 0.05 + (pct / 100) * 0.5
  const big = pct >= 100
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden>
      <div
        className={`absolute bottom-2 right-4 select-none leading-none transition-all duration-700 ${
          big && visible ? 'dragon-big' : ''
        }`}
        style={{
          fontSize: `${size}px`,
          opacity: visible ? targetOpacity : 0,
          transform: visible ? 'translateY(0)' : 'translateY(24px)',
          filter: big && visible
            ? 'drop-shadow(0 0 40px rgba(251,113,133,0.8)) drop-shadow(0 0 90px rgba(251,146,60,0.5))'
            : visible
              ? 'drop-shadow(0 0 24px rgba(251,146,60,0.55))'
              : undefined,
        }}
      >
        🐉
      </div>
    </div>
  )
}
