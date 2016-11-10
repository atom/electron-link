const assert = require('assert')
const path = require('path')
const generateSnapshotScript = require('../../lib/generate-snapshot-script')
const vm = require('vm')

suite('generateSnapshotScript({baseDirPath, mainPath})', () => {
  test('simple integration test', () => {
    const baseDirPath = __dirname
    const mainPath = path.resolve(baseDirPath, '..', 'fixtures', 'module', 'index.js')
    const snapshotScript = generateSnapshotScript({
      baseDirPath,
      mainPath,
      shouldExcludeModule: (modulePath) => modulePath.endsWith('b.js')
    })
    eval(snapshotScript)
    snapshotResult.global.require = require
    assert.equal(snapshotResult.global.initialize(), 'abbAd')
  })
})
