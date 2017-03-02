const TransformCache = require('./transform-cache')
const generateSnapshotScript = require('./generate-snapshot-script')

module.exports = async function (options) {
  const cache = new TransformCache(options.cachePath, options.shouldExcludeModule.toString())
  await cache.loadOrCreate()
  delete options.cachePath

  const result = await generateSnapshotScript(cache, options)
  await cache.dispose()
  return result
}
