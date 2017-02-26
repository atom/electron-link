const assert = require('assert')
const fs = require('fs')
const generateSnapshotScript = require('../../src/generate-snapshot-script')
const path = require('path')
const temp = require('temp').track()
const TransformCache = require('../../src/transform-cache')

suite('generateSnapshotScript({baseDirPath, mainPath})', () => {
  afterEach(() => {
    temp.cleanupSync()
  })

  test('simple integration test', async () => {
    const cache = new TransformCache(temp.mkdirSync())
    await cache.loadOrCreate()
    const baseDirPath = __dirname
    const mainPath = path.resolve(baseDirPath, '..', 'fixtures', 'module', 'index.js')

    {
      const snapshotScript = await generateSnapshotScript(cache, {
        baseDirPath,
        mainPath,
        shouldExcludeModule: (modulePath) => modulePath.endsWith('b.js')
      })
      eval(snapshotScript)
      snapshotResult.setGlobals(global, process, {}, {}, require)
      assert(!global.moduleInitialized)
      assert.equal(global.initialize(), 'abbAd')
      assert(global.moduleInitialized)
    }

    {
      await cache.put({
        original: fs.readFileSync(mainPath, 'utf8'),
        transformed: 'global.initialize = () => "cached"',
        requires: []
      })
      const snapshotScript = await generateSnapshotScript(cache, {
        baseDirPath,
        mainPath,
        shouldExcludeModule: (modulePath) => modulePath.endsWith('b.js')
      })
      eval(snapshotScript)
      snapshotResult.setGlobals(global, process, {}, {}, require)
      assert.equal(global.initialize(), 'cached')
    }
  })
})
