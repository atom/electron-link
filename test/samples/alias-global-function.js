// Create an alias to a globally-defined function, but don't call it until runtime.
// This is a common occurrence in minimized source.
//
// Run with: npx @smashwilson/run-in-snapshot --link test/samples/alias-global-function.js

const localSetTimeout = setTimeout;

// This is invalid and should fail snapshot creation.
// localSetTimeout(() => {}, 1000);

const LocalBuffer = Buffer;

// DOMPoint is only available in renderer processes
const LocalDOMPoint = DOMPoint;

// This is invalid and should fail snapshot creation.
// new Buffer(0, 0, 0, 0);

async function main() {
  // React does feature gating with "if (typeof localSetTimeout !== 'function') {}" gates.
  console.log(`typeof localSetTimeout = ${typeof localSetTimeout}`)

  console.log('calling setTimeout directly at runtime')
  await new Promise(resolve => setTimeout(resolve, 1000))

  console.log('calling setTimeout through captured alias at runtime')
  await new Promise(resolve => localSetTimeout(resolve, 1000))

  console.log('calling Buffer constructor directly at runtime')
  const b0 = new Buffer('first', 'utf8')
  console.log(`buffer 0 = ${b0.toString()}`)

  console.log('calling LocalBuffer constructor directly at runtime')
  const b1 = new LocalBuffer('second', 'utf8')
  console.log(`buffer 1 = ${b1.toString()}`)

  console.log('attempt to construct a DOMPoint with its constructor')
  try {
    new DOMPoint(0, 0, 0, 0)
    console.log('point was constructed!')
  } catch (e) {
    console.log('expected error caught: ok')
  }

  console.log('attempt to construct a DOMPoint through its aliased constructor')
  try {
    new LocalDOMPoint(0, 0, 0, 0)
    console.log('point was constructed!')
  } catch(e) {
    console.log('expected error caught: ok')
  }

  console.log('ok')

  return null;
}

exports.main = main;
