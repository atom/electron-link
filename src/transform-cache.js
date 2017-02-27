const crypto = require('crypto')
const levelup = require('levelup')

module.exports = class TransformCache {
  constructor (filePath) {
    this.filePath = filePath
    this.db = null
  }

  loadOrCreate () {
    return new Promise((resolve, reject) => {
      levelup(this.filePath, {valueEncoding: 'json'}, (error, db) => {
        if (error) {
          reject(error)
        } else {
          this.db = db
          resolve()
        }
      })
    })
  }

  async put ({filePath, original, transformed, requires}) {
    const hash = crypto.createHash('sha1')
    hash.update(original)
    const key = hash.digest('hex')
    await this._put(filePath + ':' + key + ':source', transformed)
    await this._put(filePath + ':' + key + ':requires', JSON.stringify(requires))
  }

  async get ({filePath, content}) {
    const hash = crypto.createHash('sha1')
    hash.update(content)
    const key = hash.digest('hex')
    const source = await this._get(filePath + ':' + key + ':source')
    const requires = await this._get(filePath + ':' + key + ':requires')
    if (source && requires) {
      return {source, requires: JSON.parse(requires)}
    } else {
      return null
    }
  }

  _put (key, value) {
    return new Promise((resolve, reject) => {
      this.db.put(key, value, {}, (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  _get (key) {
    return new Promise((resolve, reject) => {
      this.db.get(key, {}, (error, value) => {
        if (error) {
          if (error.notFound) {
            resolve(null)
          } else {
            reject(error)
          }
        } else {
          resolve(value)
        }
      })
    })
  }
}
