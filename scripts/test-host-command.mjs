import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

const home = await mkdtemp(join(tmpdir(), 'rice-vat-command-'))
process.env.DSH_HOME = home

const { apply } = await import('../index.js')

function fakeContext() {
  const state = { command: null, scopes: 0, webRoutes: [] }
  const disposer = () => () => {}
  const ctx = {
    get(name) {
      if (name === 'webServer') return { register(route) { state.webRoutes.push(route); return disposer() } }
      return undefined
    },
    effect(fn) {
      const cleanup = fn()
      return typeof cleanup === 'function' ? cleanup : disposer()
    },
    on() {
      return disposer()
    },
    inject(names, callback) {
      state.scopes += 1
      const scope = {
        effect(fn) { const cleanup = fn(); return typeof cleanup === 'function' ? cleanup : disposer() },
        commands: {
          register(definition) {
            state.command = definition
            return disposer()
          },
        },
      }
      callback(scope)
    },
  }
  return { ctx, state }
}

test('registers /rice-vat and persists on/off without touching billing', async () => {
  const { ctx, state } = fakeContext()
  apply(ctx)
  assert.ok(state.command, 'command registered')
  assert.equal(state.command.name, 'rice-vat')
  assert.deepEqual(state.command.input, { hint: 'on | off' })
  assert.equal(state.webRoutes.length, 1, 'web route still registered')

  const off = await state.command.handler({ rawInput: ' off ' })
  assert.equal(off.kind, 'success')
  assert.match(off.text, /off/i)
  const offFile = JSON.parse(await readFile(join(home, 'rice-bowl', 'ui.json'), 'utf8'))
  assert.deepEqual(offFile, { visible: false })

  const on = await state.command.handler({ rawInput: 'ON' })
  assert.equal(on.kind, 'success')
  assert.match(on.text, /on/i)
  const onFile = JSON.parse(await readFile(join(home, 'rice-bowl', 'ui.json'), 'utf8'))
  assert.deepEqual(onFile, { visible: true })

  const invalid = await state.command.handler({ rawInput: 'maybe' })
  assert.equal(invalid.kind, 'error')
  assert.match(invalid.text, /on \| off/i)

  await rm(home, { recursive: true, force: true })
})
