'use strict'

const assert = require('assert')
const path = require('path')
const generateSnapshotScript = require('../../lib/generate-snapshot-script')
const vm = require('vm')

suite('generateSnapshotScript({baseDirPath, mainPath})', () => {
  test('simple integration test', () => {
    const baseDirPath = path.resolve(__dirname, '../fixtures/module')
    const mainPath = path.join(baseDirPath, 'index.js')
    const snapshotScript = generateSnapshotScript({baseDirPath, mainPath})
    const sandbox = {}
    vm.runInNewContext(snapshotScript, sandbox)
    assert.equal(sandbox.snapshotResult.foo, 'abbA')
  })
})
