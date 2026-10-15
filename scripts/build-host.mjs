import { readFileSync, writeFileSync } from 'node:fs'
import ts from 'typescript'

const source = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
const result = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2024,
  },
  fileName: 'src/index.ts',
})

writeFileSync(new URL('../lib/index.js', import.meta.url), result.outputText, 'utf8')
