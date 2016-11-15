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
    snapshotResult.setGlobals(global, process, {}, require)
    assert(!global.moduleInitialized)
    assert.equal(global.initialize(), 'abbAd')
    assert(global.moduleInitialized)
  })
})
