// Create an alias to a globally-defined function, but don't call it until runtime.
// This is a common occurrence in minimized source.
//
// Run with: npx @smashwilson/run-in-snapshot --link test/samples/alias-global-function.js

const aliased = setTimeout;

// This is invalid and should fail snapshot creation.
// aliased(() => {}, 1000);

async function main() {
  // React does feature gating with "if (typeof A !== 'function') {}" gates.
  console.log(`typeof aliased = ${typeof aliased}`);

  console.log('calling setTimeout directly at runtime')
  await new Promise(resolve => setTimeout(resolve, 1000));

  console.log('calling setTimeout through captured alias at runtime')
  await new Promise(resolve => aliased(resolve, 1000));

  return null;
}

exports.main = main;
