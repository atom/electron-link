'use strict'

const assert = require('assert')
const dedent = require('dedent')
const deferRequires = require('../../lib/defer-requires')

suite('deferRequires(source, deferredModules)', () => {
  test('simple require', () => {
    assert.equal(deferRequires(dedent`
      const a = require('a')
      const b = require('b')
      function main () {
        return a + b
      }
    `, new Set(['a'])), dedent`
      let a;

      function get_a() {
        return a = a || require('a');
      }

      const b = require('b')
      function main () {
        return get_a() + b
      }
    `)
  })

  test('top-level variables assignments that depend on previous requires', () => {
    assert.equal(deferRequires(dedent`
      const a = require('a')
      const b = require('b')
      const c = require('c').c.d
      var e
      e = c.e
      const f = b.f
      function main () {
        c.foo()
        e()
      }
    `, new Set(['a', 'c'])), dedent`
      let a;

      function get_a() {
        return a = a || require('a');
      }

      const b = require('b')
      let c;

      function get_c() {
        return c = c || require('c').c.d;
      }

      var e
      function get_e() {
        return e = e || get_c().e;
      };
      const f = b.f
      function main () {
        get_c().foo()
        get_e()()
      }
    `)
  })

  test('top-level usage of deferred modules', () => {
    assert.throws(() => {
      deferRequires(dedent`
        var a = require('a')
        a()
      `, new Set(['a']))
    })
    assert.throws(() => {
      deferRequires(dedent`
        require('a')()
      `, new Set(['a']))
    })
  })

  test('requires that appear in a closure wrapper defined in the top-level scope (e.g. CoffeeScript)', () => {
    assert.equal(deferRequires(dedent`
      (function () {
        const a = require('a')
        const b = require('b')
        function main () {
          return a + b
        }
      }).call(this)
    `, new Set(['a'])), dedent`
      (function () {
        let a;

        function get_a() {
          return a = a || require('a');
        }

        const b = require('b')
        function main () {
          return get_a() + b
        }
      }).call(this)
    `)
  })

  test('references to shadowed variables', () => {
    assert.equal(deferRequires(dedent`
      const a = require('a')
      function outer () {
        console.log(a)
        function inner () {
          console.log(a)
        }
        let a = []
      }

      function other () {
        console.log(a)
        function inner () {
          let a = []
          console.log(a)
        }
      }
    `, new Set(['a'])), dedent`
      let a;

      function get_a() {
        return a = a || require('a');
      }

      function outer () {
        console.log(a)
        function inner () {
          console.log(a)
        }
        let a = []
      }

      function other () {
        console.log(get_a())
        function inner () {
          let a = []
          console.log(a)
        }
      }
    `)
  })
})
