module.exports = (mode, options) => {
  switch (mode) {
    case 'componentTestingInteractive':
      return require('./component-testing').launchInteractiveMode(options)
    case 'componentTestingRun':
      return require('./component-testing').launchRunMode(options)
    case 'record':
      return require('./record').run(options)
    case 'run':
      return require('./run').run(options)
    case 'interactive':
      return require('./interactive').run(options)
    case 'smokeTest':
      return require('./smoke_test').run(options)
    default:
      break
  }
}
