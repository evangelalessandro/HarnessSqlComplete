// Configura Monaco per il bundling locale (niente CDN) e i relativi web worker.
// Nota: monaco-editor 0.56 usa un exports map "/*" -> "./esm/vs/*.js",
// quindi i subpath vanno scritti relativi a "esm/vs" (es. "editor/editor.worker").
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import editorWorker from 'monaco-editor/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/language/typescript/ts.worker?worker'

;(self as unknown as {
  MonacoEnvironment: {
    getWorker: (moduleId: unknown, label: string) => Worker
  }
}).MonacoEnvironment = {
  getWorker(_moduleId: unknown, label: string) {
    if (label === 'json') return new jsonWorker()
    if (label === 'css' || label === 'scss' || label === 'less') return new cssWorker()
    if (label === 'html' || label === 'handlebars' || label === 'razor') return new htmlWorker()
    if (label === 'typescript' || label === 'javascript') return new tsWorker()
    return new editorWorker()
  },
}

loader.config({ monaco })

export default monaco
