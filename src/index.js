const TransformCache = require('./transform-cache')
const generateSnapshotScript = require('./generate-snapshot-script')

module.exports = async function (options) {
  const cache = new TransformCache(options.cachePath)
  await cache.loadOrCreate()
  delete options.cachePath

  return generateSnapshotScript(cache, options)
}
