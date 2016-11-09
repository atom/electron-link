'use strict'

module.exports = class Point {
  static fromLocation (location) {
    return new Point(location.line, location.column)
  }

  constructor (row, column) {
    this.row = row
    this.column = column
  }

  compare (other) {
    return this.row === other.row ? this.column - other.column : this.row - other.row
  }
}
