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
    const cachePath = temp.mkdirSync()

    {
      const cache = new TransformCache(cachePath, 'invalidation-key')
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
      assert.equal((await cache._allKeys()).size, 9)
      await cache.dispose()
    }

    {
      const cache = new TransformCache(cachePath, 'invalidation-key')
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
      assert.equal((await cache._allKeys()).size, 3)
      await cache.dispose()
    }

    {
      const cache = new TransformCache(cachePath, 'a-new-invalidation-key')
      await cache.loadOrCreate()
      const snapshotScript = await generateSnapshotScript(cache, {
        baseDirPath,
        mainPath,
        shouldExcludeModule: (modulePath) => modulePath.endsWith('b.js')
      })
      eval(snapshotScript)
      snapshotResult.setGlobals(global, process, {}, {}, require)
      assert.equal(global.initialize(), 'abx/ybAd')
      assert.equal((await cache._allKeys()).size, 9)
      await cache.dispose()
    }
  })

  test('cyclic requires', async () => {
    const baseDirPath = __dirname
    const mainPath = path.resolve(baseDirPath, '..', 'fixtures', 'cyclic-require', 'a.js')
    const cachePath = temp.mkdirSync()

    {
      const cache = new TransformCache(cachePath, 'invalidation-key')
      await cache.loadOrCreate()
      const snapshotScript = await generateSnapshotScript(cache, {
        baseDirPath,
        mainPath,
        shouldExcludeModule: () => false
      })
      eval(snapshotScript)
      snapshotResult.setGlobals(global, process, {}, {}, require)
      assert.deepEqual(global.cyclicRequire, {a: 1, b: 2})
      await cache.dispose()
    }
  })

  test('process.platform', async () => {
    const baseDirPath = __dirname
    const mainPath = path.resolve(baseDirPath, '..', 'fixtures', 'module-2', 'index.js')
    const cache = new TransformCache(temp.mkdirSync(), 'invalidation-key')
    await cache.loadOrCreate()
    const snapshotScript = await generateSnapshotScript(cache, {
      baseDirPath,
      mainPath,
      shouldExcludeModule: () => false
    })
    eval(snapshotScript)
    snapshotResult.setGlobals(global, process, {}, {}, require)
    assert.deepEqual(global.module2, {platform: process.platform})
    await cache.dispose()
  })
})
