import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const buttonStyles: Record<ButtonVariant, string> = {
  primary: 'bg-sky-600 hover:bg-sky-500 text-white shadow-sm',
  secondary: 'bg-zinc-800 hover:bg-zinc-700 text-zinc-100 border border-zinc-700',
  ghost: 'hover:bg-zinc-800 text-zinc-300 border border-transparent',
  danger: 'bg-rose-800 hover:bg-rose-700 text-white',
}

export function Button({
  children,
  loading,
  variant = 'primary',
  size = 'md',
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  loading?: boolean
  variant?: ButtonVariant
  size?: 'sm' | 'md'
}) {
  return (
    <button
      className={`inline-flex items-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'sm' ? 'px-2 py-1 text-xs' : 'px-3 py-1.5'
      } ${buttonStyles[variant]} ${className}`}
      {...rest}
    >
      {loading && <Loader2 className="h-4 w-4 animate-spin" />}
      {children}
    </button>
  )
}

export function Toggle({
  checked,
  onChange,
  label,
  title,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  title?: string
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={() => onChange(!checked)}
      className="flex items-center gap-2 text-sm text-zinc-300 transition-colors hover:text-zinc-100"
    >
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? 'bg-sky-600' : 'bg-zinc-700'
        }`}
      >
        <span
          className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
            checked ? 'translate-x-4.5' : 'translate-x-1'
          }`}
        />
      </span>
      {label}
    </button>
  )
}

type BadgeTone = 'zinc' | 'sky' | 'emerald' | 'amber' | 'rose' | 'violet'

const badgeStyles: Record<BadgeTone, string> = {
  zinc: 'bg-zinc-800 text-zinc-300',
  sky: 'bg-sky-950 text-sky-300 border border-sky-800',
  emerald: 'bg-emerald-950 text-emerald-300 border border-emerald-800',
  amber: 'bg-amber-950 text-amber-300 border border-amber-800',
  rose: 'bg-rose-950 text-rose-300 border border-rose-800',
  violet: 'bg-violet-950 text-violet-300 border border-violet-800',
}

export function Badge({ children, tone = 'zinc', className = '' }: { children: ReactNode; tone?: BadgeTone; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] font-medium ${badgeStyles[tone]} ${className}`}>
      {children}
    </span>
  )
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return <Loader2 className={`animate-spin text-sky-400 ${className}`} />
}

export const inputClass =
  'w-full rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-500 transition-colors focus:border-sky-500 focus:outline-none'
