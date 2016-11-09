const assert = require('assert')
const path = require('path')
const generateSnapshotScript = require('../../lib/generate-snapshot-script')

suite('generateSnapshotScript({baseDirPath, mainPath})', () => {
  test('simple integration test', () => {
    const baseDirPath = path.resolve(__dirname, '../fixtures/module')
    const mainPath = path.join(baseDirPath, 'index.js')
    const snapshotScript = generateSnapshotScript({baseDirPath, mainPath})
    eval(snapshotScript)
    assert.equal(snapshotResult.foo, 'abbA')
  })
})
