// Effetto "Matrix rain" di sfondo (pioggia di caratteri verde) per la schermata di login.
import { useEffect, useRef } from 'react'

const CHARS = 'アイウエオカキクケコサシスセソタチツテトナニヌネノ0123456789ABCDEF#$%&+*<=>?@'

interface Props {
  /** Opacità del canvas rispetto al contenuto sottostante. */
  opacity?: number
}

export default function MatrixRain({ opacity = 0.45 }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let raf = 0
    let cols = 0
    let drops: number[] = []
    const fontSize = 14

    const resize = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      cols = Math.max(1, Math.floor(canvas.width / fontSize))
      // partenze distribuite su TUTTA l'altezza: la pioggia è visibile subito
      const maxY = Math.max(1, Math.floor(canvas.height / fontSize))
      drops = Array.from({ length: cols }, () => Math.floor(Math.random() * maxY))
      ctx.fillStyle = '#020617'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
    }

    const draw = () => {
      // scia: sfondo semitrasparente sopra il frame precedente (le gocce restano ~20 frame)
      ctx.fillStyle = 'rgba(2, 6, 23, 0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.font = `${fontSize}px monospace`
      for (let i = 0; i < cols; i++) {
        const ch = CHARS[Math.floor(Math.random() * CHARS.length)]
        const x = i * fontSize
        const y = drops[i] * fontSize
        // testa della goccia più brillante, corpo verde classico
        ctx.fillStyle = Math.random() > 0.975 ? '#ccffcc' : '#22c55e'
        ctx.fillText(ch, x, y)
        if (y > canvas.height && Math.random() > 0.975) drops[i] = 0
        drops[i]++
      }
      raf = requestAnimationFrame(draw)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <canvas
      ref={ref}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0"
      style={{ opacity }}
    />
  )
}
