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
    const baseDirPath = __dirname
    const mainPath = path.resolve(baseDirPath, '..', 'fixtures', 'module-1', 'index.js')

    {
      const cache = new TransformCache(temp.mkdirSync())
      await cache.loadOrCreate()
      const snapshotScript = await generateSnapshotScript(cache, {
        baseDirPath,
        mainPath,
        shouldExcludeModule: (modulePath) => modulePath.endsWith('b.js')
      })
      eval(snapshotScript)
      snapshotResult.setGlobals(global, process, {}, {}, require)
      assert(!global.moduleInitialized)
      assert.equal(global.initialize(), 'abx/ybAd')
      assert(global.moduleInitialized)
      assert.equal((await cache._allKeys()).size, 8)
    }

    {
      const cache = new TransformCache(temp.mkdirSync())
      await cache.loadOrCreate()
      await cache.put({
        filePath: mainPath,
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
      assert.equal((await cache._allKeys()).size, 2)
    }
  })

  test('process.platform', async () => {
    const baseDirPath = __dirname
    const mainPath = path.resolve(baseDirPath, '..', 'fixtures', 'module-2', 'index.js')
    const cache = new TransformCache(temp.mkdirSync())
    await cache.loadOrCreate()
    const snapshotScript = await generateSnapshotScript(cache, {
      baseDirPath,
      mainPath,
      shouldExcludeModule: () => false
    })
    eval(snapshotScript)
    snapshotResult.setGlobals(global, process, {}, {}, require)
    assert.deepEqual(global.module2, {platform: process.platform})
  })
})
