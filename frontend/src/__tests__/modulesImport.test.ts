// @vitest-environment jsdom
// Guardia: importa i moduli "grossi" dell'app. Un errore di sintassi in un file che
// nessun test importa (es. SqlEditor.tsx) NON faceva fallire la suite e arrivava
// direttamente nel browser come errore di build di Vite. Qui l'import fallisce subito.
import { describe, expect, it } from 'vitest'
import App from '../App'
import SqlEditor, { DEFAULT_SQL } from '../components/SqlEditor'
import Sidebar from '../components/Sidebar'
import ResultsPanel from '../components/ResultsPanel'
import PrintPanel from '../components/PrintPanel'
import HelpPage from '../components/HelpPage'
import DataPreviewModal from '../components/DataPreviewModal'
import SelectableResultGrid from '../components/SelectableResultGrid'
import FormatProfilePanel from '../components/FormatProfilePanel'
import TableReportModal from '../components/TableReportModal'
import LoginScreen from '../components/LoginScreen'
import * as formatter from '../tsqlFormatter'
import * as localTables from '../localTables'
import * as intellisense from '../intellisenseContext'

describe('moduli dell\'app: import senza errori di sintassi', () => {
  it('i componenti principali sono esportati', () => {
    expect(typeof App).toBe('function')
    expect(typeof SqlEditor).toBe('function')
    expect(typeof Sidebar).toBe('function')
    expect(typeof ResultsPanel).toBe('function')
    expect(typeof PrintPanel).toBe('function')
    expect(typeof HelpPage).toBe('function')
    expect(typeof DataPreviewModal).toBe('function')
    expect(typeof SelectableResultGrid).toBe('function')
    expect(typeof FormatProfilePanel).toBe('function')
    expect(typeof TableReportModal).toBe('function')
    expect(typeof LoginScreen).toBe('function')
    expect(typeof DEFAULT_SQL).toBe('string')
  })

  it('i moduli di logica esportano le funzioni chiave', () => {
    expect(typeof formatter.formatSqlWithProfile).toBe('function')
    expect(typeof formatter.formatRoutineWithProfile).toBe('function')
    expect(typeof formatter.tokenizeSqlText).toBe('function')
    expect(typeof localTables.extractLocalTables).toBe('function')
    expect(typeof intellisense.classifyContext).toBe('function')
  })
})
