const TransformCache = require('./transform-cache')
const generateSnapshotScript = require('./generate-snapshot-script')

module.exports = async function (options) {
  const cacheInvalidationKey = options.shouldExcludeModule.toString() + require('../package.json').version
  const cache = new TransformCache(options.cachePath, cacheInvalidationKey)
  await cache.loadOrCreate()
  delete options.cachePath

  const result = await generateSnapshotScript(cache, options)
  await cache.dispose()
  return result
}
