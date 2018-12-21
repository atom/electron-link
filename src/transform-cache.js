const crypto = require('crypto')
const levelup = require('levelup')
const encode = require('encoding-down')
const leveldown = require('leveldown')

module.exports = class TransformCache {
  constructor (filePath, invalidationKey) {
    this.filePath = filePath
    this.invalidationKey = invalidationKey
    this.db = null
    this.usedKeys = new Set()
  }

  async loadOrCreate () {
    await this._initialize()
    const oldKey = await this._get('invalidation-key')
    const newKey = crypto.createHash('sha1').update(this.invalidationKey).digest('hex')
    if (oldKey !== newKey) {
      const keys = await this._allKeys()
      const deleteOperations = Array.from(keys).map((key) => { return {key, type: 'del'} })
      await this._batch(deleteOperations)
      await this._put('invalidation-key', newKey)
    }
  }

  dispose () {
    return new Promise((resolve, reject) => {
      this.db.close((error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  async put ({filePath, original, transformed, requires}) {
    const key = crypto.createHash('sha1').update(original).digest('hex')
    await this._put(filePath + ':' + key + ':source', transformed)
    await this._put(filePath + ':' + key + ':requires', JSON.stringify(requires))
  }

  async get ({filePath, content}) {
    const key = crypto.createHash('sha1').update(content).digest('hex')
    const source = await this._get(filePath + ':' + key + ':source')
    const requires = await this._get(filePath + ':' + key + ':requires')
    if (source && requires) {
      return {source, requires: JSON.parse(requires)}
    } else {
      return null
    }
  }

  async deleteUnusedEntries () {
    const unusedKeys = await this._allKeys()
    for (const key of this.usedKeys) {
      unusedKeys.delete(key)
    }

    const deleteOperations = Array.from(unusedKeys).map((key) => { return {key, type: 'del'} })
    await this._batch(deleteOperations)
  }

  _initialize () {
    return new Promise((resolve, reject) => {
      levelup(encode(leveldown(this.filePath)), {}, (error, db) => {
        if (error) {
          reject(error)
        } else {
          this.db = db
          resolve()
        }
      })
    })
  }

  _put (key, value) {
    return new Promise((resolve, reject) => {
      this.db.put(key, value, {}, (error) => {
        if (error) {
          reject(error)
        } else {
          this.usedKeys.add(key)
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
          this.usedKeys.add(key)
          resolve(value)
        }
      })
    })
  }

  _allKeys () {
    return new Promise((resolve, reject) => {
      const keys = new Set()
      const stream = this.db.createKeyStream()
      stream.on('data', (key) => { keys.add(key) })
      stream.on('error', (error) => { reject(error) })
      stream.on('close', () => { resolve(keys) })
    })
  }

  _batch (operations) {
    return new Promise((resolve, reject) => {
      this.db.batch(operations, {}, (error) => {
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }
}
