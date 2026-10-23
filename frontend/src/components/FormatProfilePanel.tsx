import { useEffect, useRef, useState } from 'react'
import { Download, FileUp, RotateCcw, X } from 'lucide-react'
import type { FormatProfileNode } from '../formatProfile'
import {
  etichettaMotore,
  MOTORI_FORMATTAZIONE,
  normalizzaOpzioniSqlFluff,
  OPZIONI_SQLFLUFF_DEFAULT,
  OPZIONI_SQLFLUFF_UI,
} from '../formatEngine'
import type { MotoreFormattazione, OpzioniSqlFluff } from '../formatEngine'
import {
  buildFormatProfile,
  flattenFormatOptions,
  loadFormatProfileXml,
  parseFormatProfileXml,
  resetFormatProfileXml,
  saveFormatProfileXml,
  serializeFormatProfile,
  setFormatOption,
} from '../formatProfile'
import { Button } from './ui'

/** Descrittore di un'opzione editabile nella UI (con etichetta italiana). */
interface EditableOption {
  key: string
  label: string
  kind: 'bool' | 'number'
  hint?: string
  min?: number
  max?: number
}

const EDITABLE_OPTIONS: EditableOption[] = [
  { key: 'Select_SingleLine_WhenRightMarginIsNotExceeded', label: 'Query brevi su una sola riga', kind: 'bool' },
  { key: 'Select_SingleLine_WhenQueryIsShorterThanXCharacters_Value', label: 'Soglia caratteri (query breve)', kind: 'number', min: 1, max: 500 },
  { key: 'Select_SingleLine_WhenQueryContainsLessThanXWords_Value', label: 'Soglia parole (query breve)', kind: 'number', min: 1, max: 200 },
  { key: 'Select_SelectList_StackColumns', label: 'Impila le colonne della SELECT', kind: 'bool' },
  { key: 'Select_SelectList_IndentColumnList_Size', label: 'Indentazione colonne SELECT', kind: 'number', min: 0, max: 20 },
  { key: 'Select_From_LineBreakBeforeFrom', label: 'A capo prima di FROM', kind: 'bool' },
  { key: 'Select_From_Join_LineBreakBeforeJoin', label: 'A capo prima di JOIN', kind: 'bool' },
  { key: 'Select_From_Join_IndentJoinKeyword_Size', label: 'Indentazione JOIN', kind: 'number', min: 0, max: 20 },
  { key: 'Select_From_Join_LineBreakBeforeOn', label: 'A capo prima di ON', kind: 'bool' },
  { key: 'Select_Where_LineBreakBeforeWhere', label: 'A capo prima di WHERE', kind: 'bool' },
  { key: 'Select_Where_IndentWhereCondition_Size', label: 'Indentazione condizione WHERE', kind: 'number', min: 0, max: 30 },
  { key: 'Select_GroupBy_LineBreakBeforeGroup', label: 'A capo prima di GROUP BY', kind: 'bool' },
  { key: 'Select_Having_LineBreakBeforeHaving', label: 'A capo prima di HAVING', kind: 'bool' },
  { key: 'Select_OrderBy_LineBreakBeforeOrder', label: 'A capo prima di ORDER BY', kind: 'bool' },
  { key: 'Select_OrderBy_IndentOrderByPhrase_Size', label: 'Indentazione ORDER BY', kind: 'number', min: 0, max: 20 },
  { key: 'UnionExceptIntersect_LineBreakBeforeUnion', label: 'A capo prima di UNION', kind: 'bool' },
  { key: 'Insert_ColumnList_LineBreakBeforeOpenBrace', label: 'INSERT: parentesi colonne su riga propria', kind: 'bool' },
  { key: 'Insert_Values_LineBreakBeforeValues', label: 'A capo prima di VALUES', kind: 'bool' },
  { key: 'Update_SetClause_LineBreakBeforeSet', label: 'A capo prima di SET (UPDATE)', kind: 'bool' },
  { key: 'Update_SetClause_IndentSetKeyword_Size', label: 'Indentazione SET', kind: 'number', min: 0, max: 20 },
  { key: 'TextCase_Keyword', label: 'Keyword in MAIUSCOLO (1=sì)', kind: 'number', min: 0, max: 1 },
  { key: 'TextCase_DataType', label: 'Tipi di dato in MAIUSCOLO (1=sì)', kind: 'number', min: 0, max: 1 },
  { key: 'Spacing_Delimiters_InsertSpaceAfterComma', label: 'Spazio dopo la virgola', kind: 'bool' },
]

function downloadFile(name: string, content: string) {
  const blob = new Blob([content], { type: 'application/xml' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

export default function FormatProfilePanel({
  onClose,
  motore = 'nostro',
  onMotoreChange,
  opzioni,
  onOpzioniChange,
  virgolaACapo = true,
  onVirgolaACapoChange,
}: {
  onClose: () => void
  motore?: MotoreFormattazione
  onMotoreChange?: (m: MotoreFormattazione) => void
  opzioni?: OpzioniSqlFluff
  onOpzioniChange?: (o: OpzioniSqlFluff) => void
  /** Invio dopo la virgola → virgola in testa alla riga nuova (richiesta utente). */
  virgolaACapo?: boolean
  onVirgolaACapoChange?: (attiva: boolean) => void
}) {
  const [xml, setXml] = useState<string>(() => loadFormatProfileXml())
  const [nodes, setNodes] = useState<FormatProfileNode[]>(() => parseFormatProfileXml(loadFormatProfileXml()))
  const [message, setMessage] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)

  const flat = flattenFormatOptions(nodes)
  const profile = buildFormatProfile(xml)

  useEffect(() => {
    setMessage(null)
  }, [xml])

  const update = (key: string, value: string) => {
    const next = [...nodes]
    setFormatOption(next, key, value)
    setNodes(next)
    const nextXml = serializeFormatProfile(next)
    setXml(nextXml)
    saveFormatProfileXml(nextXml)
  }

  const handleImportFile = (file: File) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const text = String(reader.result ?? '')
        if (!text.includes('FormatProfile')) throw new Error('File non valido: manca FormatProfile')
        const parsed = parseFormatProfileXml(text)
        setNodes(parsed)
        setXml(serializeFormatProfile(parsed))
        saveFormatProfileXml(serializeFormatProfile(parsed))
        setMessage('Profilo importato e salvato.')
      } catch (e) {
        setMessage(`Importazione fallita: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    reader.readAsText(file)
  }

  const handleReset = () => {
    resetFormatProfileXml()
    const def = parseFormatProfileXml(loadFormatProfileXml())
    setNodes(def)
    setXml(serializeFormatProfile(def))
    setMessage('Profilo ripristinato al default.')
  }

  const handleExport = () => {
    downloadFile('formatprofile.xml', xml)
    setMessage('Profilo esportato (formatprofile.xml).')
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl border border-zinc-700 bg-zinc-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Formattazione T-SQL</h2>
            <p className="text-xs text-zinc-500">Profilo FormatProfile (Redgate / SQL Prompt)</p>
          </div>
          <button onClick={onClose} className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200" title="Chiudi">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 bg-zinc-900/60 px-4 py-2.5">
          <label className="text-xs font-medium text-zinc-300" htmlFor="motore-formattazione">Motore</label>
          <select
            id="motore-formattazione"
            data-format="motore"
            value={motore}
            onChange={e => onMotoreChange?.(e.target.value as MotoreFormattazione)}
            className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1 text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
          >
            {MOTORI_FORMATTAZIONE.map(m => (
              <option key={m} value={m}>{etichettaMotore(m)}</option>
            ))}
          </select>
          <span className="text-[11px] text-zinc-500">
            {motore === 'nostro'
              ? 'Come finora: profilo e regole dell\u2019app (un testo già impaginato resta identico).'
              : 'SQLFluff gira sul backend (serve Python con sqlfluff installato).'}
          </span>
        </div>
        {/* SCRITTURA: Invio dopo la virgola → la virgola va in testa alla riga nuova */}
        <div className="flex items-center gap-2 border-b border-zinc-800 bg-zinc-900/40 px-4 py-2">
          <input
            id="virgola-a-capo"
            data-format="virgola-a-capo"
            type="checkbox"
            checked={virgolaACapo}
            onChange={e => onVirgolaACapoChange?.(e.target.checked)}
            className="h-3.5 w-3.5 accent-sky-500"
          />
          <label htmlFor="virgola-a-capo" className="text-xs text-zinc-300">
            Virgola a capo automatica
          </label>
          <span className="text-[11px] text-zinc-500">
            Invio dopo la virgola: la virgola va in testa alla riga nuova, incolonnata sotto il primo campo
          </span>
        </div>
        {motore === 'sqlfluff' && (
          <div className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-zinc-800 bg-zinc-900/40 px-4 py-3" data-format="opzioni-sqlfluff">
            {OPZIONI_SQLFLUFF_UI.map(o => {
              const valore = opzioni ? opzioni[o.key] : OPZIONI_SQLFLUFF_DEFAULT[o.key]
              return (
                <label key={o.key} className="flex items-center justify-between gap-2 text-[11px] text-zinc-400">
                  <span>{o.label}</span>
                  {o.tipo === 'numero' ? (
                    <input
                      type="number"
                      min={o.min}
                      max={o.max}
                      value={String(valore)}
                      onChange={e => {
                        const n = Number(e.target.value)
                        if (!Number.isFinite(n)) return
                        onOpzioniChange?.(normalizzaOpzioniSqlFluff({ ...opzioni, [o.key]: n }))
                      }}
                      className="w-20 rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-right text-zinc-100 focus:border-sky-500 focus:outline-none"
                      data-format={o.key}
                    />
                  ) : o.tipo === 'bool' ? (
                    <select
                      value={String(valore)}
                      onChange={e => onOpzioniChange?.(normalizzaOpzioniSqlFluff({ ...opzioni, [o.key]: e.target.value === 'true' }))}
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-100 focus:border-sky-500 focus:outline-none"
                      data-format={o.key}
                    >
                      <option value="false">no</option>
                      <option value="true">sì</option>
                    </select>
                  ) : (
                    <select
                      value={String(valore)}
                      onChange={e => onOpzioniChange?.(normalizzaOpzioniSqlFluff({ ...opzioni, [o.key]: e.target.value }))}
                      className="rounded border border-zinc-700 bg-zinc-950 px-2 py-0.5 text-zinc-100 focus:border-sky-500 focus:outline-none"
                      data-format={o.key}
                    >
                      {(o.scelte ?? []).map(s => (
                        <option key={s.valore} value={s.valore}>{s.label}</option>
                      ))}
                    </select>
                  )}
                </label>
              )
            })}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-800 px-4 py-2">
          <Button variant="secondary" onClick={() => fileRef.current?.click()} title="Importa un file formatprofile.xml">
            <FileUp className="h-4 w-4" /> Importa
          </Button>
          <input
            ref={fileRef}
            type="file"
            accept=".xml,application/xml"
            className="hidden"
            onChange={e => {
              const f = e.target.files?.[0]
              if (f) handleImportFile(f)
              e.target.value = ''
            }}
          />
          <Button variant="secondary" onClick={handleExport} title="Scarica il profilo come formatprofile.xml">
            <Download className="h-4 w-4" /> Esporta
          </Button>
          <Button variant="ghost" onClick={handleReset} title="Ripristina il profilo predefinito">
            <RotateCcw className="h-4 w-4" /> Ripristina default
          </Button>
          {message && <span className="text-xs text-emerald-400">{message}</span>}
          <span className="ml-auto text-[11px] text-zinc-600">{flat.size} opzioni nel profilo</span>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <div className="space-y-3">
            {EDITABLE_OPTIONS.map(opt => {
              const raw = flat.get(opt.key)
              const isBool = opt.kind === 'bool'
              const boolVal = raw ? raw.toLowerCase() === 'true' : false
              const numVal = raw ? Number(raw) : 0
              return (
                <label key={opt.key} className="flex items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
                  <div>
                    <span className="text-[13px] text-zinc-200">{opt.label}</span>
                    {opt.hint && <span className="block text-[11px] text-zinc-500">{opt.hint}</span>}
                  </div>
                  {isBool ? (
                    <input
                      type="checkbox"
                      checked={boolVal}
                      onChange={e => update(opt.key, e.target.checked ? 'true' : 'false')}
                      className="h-4 w-4 accent-sky-500"
                    />
                  ) : (
                    <input
                      type="number"
                      value={Number.isFinite(numVal) ? numVal : 0}
                      min={opt.min}
                      max={opt.max}
                      onChange={e => update(opt.key, String(Number(e.target.value) || 0))}
                      className="w-20 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-right text-xs text-zinc-100 focus:border-sky-500 focus:outline-none"
                    />
                  )}
                </label>
              )
            })}
          </div>
          <p className="mt-4 text-[11px] leading-relaxed text-zinc-500">
            Il profilo completo (tutte le opzioni Redgate, anche quelle non elencate qui) viene conservato
            integralmente: importare, modificare ed esportare non perde nessuna voce. L'anteprima usa
            <span className="text-zinc-300"> {profile.breakBeforeFrom ? 'a capo' : 'no'} prima di FROM</span>, ind.
            colonne SELECT {profile.selectColumnIndent}, ind. JOIN {profile.joinIndent}.
          </p>
        </div>
      </div>
    </div>
  )
}
