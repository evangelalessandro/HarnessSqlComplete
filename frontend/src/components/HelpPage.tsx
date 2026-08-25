import { useEffect, useState } from 'react'
import { BookOpen, Search, Sparkles, Wand2, X } from 'lucide-react'
import { Badge } from './ui'
import { HELP_SECTIONS, HELP_SEARCHABLE } from '../helpContent'
const SECTIONS = HELP_SECTIONS
const SEARCHABLE = HELP_SEARCHABLE

export default function HelpPage({ onClose }: { onClose: () => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(SECTIONS.map(s => [s.id, true])))

  const query = q.trim().toLowerCase()
  const visibleSections = query
    ? SECTIONS.map(s => ({
        ...s,
        items: s.items.filter(i => `${i.title} ${i.detail}`.toLowerCase().includes(query)),
      })).filter(s => s.items.length > 0)
    : SECTIONS

  // Esc chiude la guida
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4">
      <div className="flex h-[90vh] w-full max-w-4xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-5 py-3">
          <div className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-sky-400" />
            <h1 className="text-base font-semibold text-zinc-100">Guida — SQL Intelligence Assistant</h1>
            <Badge tone="sky">{SEARCHABLE.length} funzioni documentate</Badge>
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" title="Chiudi (Esc)">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 border-b border-zinc-800 px-5 py-2">
          <Search className="h-4 w-4 text-zinc-500" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Cerca una funzione (es. join, formato, exec, colori)…"
            className="w-full bg-transparent text-sm text-zinc-100 placeholder-zinc-500 focus:outline-none"
            autoFocus
          />
          <Sparkles className="h-4 w-4 text-amber-400" />
          <Wand2 className="h-4 w-4 text-emerald-400" />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {visibleSections.length === 0 && (
            <p className="py-10 text-center text-sm text-zinc-500">Nessuna funzione trovata per "{q}".</p>
          )}
          <div className="space-y-6">
            {visibleSections.map(section => (
              <section key={section.id}>
                <button
                  onClick={() => setOpen(prev => ({ ...prev, [section.id]: !prev[section.id] }))}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-zinc-100 transition-colors hover:bg-zinc-800"
                >
                  {section.icon}
                  <span>{section.title}</span>
                  <span className="ml-auto rounded-full bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-400">
                    {section.items.length}
                  </span>
                </button>
                {open[section.id] !== false && (
                  <div className="mt-1 space-y-2 pl-8">
                    {section.items.map(item => (
                      <div key={item.title} className="rounded-lg border border-zinc-800 bg-zinc-900/50 px-3 py-2">
                        <div className="text-[13px] font-medium text-sky-300">{item.title}</div>
                        <div className="mt-0.5 text-[13px] leading-relaxed text-zinc-300">{item.detail}</div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
