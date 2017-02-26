#!/usr/bin/env node

// snapshot details about the current repo
// and optionally save them to a file

const fs = require('fs')
const _ = require('lodash')
const { gitDescribeSync } = require('git-describe')

var outputFile = (process.argv[2] || '').trim()

const gitInfo = gitDescribeSync()
const version = _.extend(_.pick(gitInfo, [
  'raw', 'semverString'
]), {
  date: (new Date()).toISOString()
})

if (outputFile) {
  fs.writeFileSync(outputFile, JSON.stringify(version))
  console.log('Wrote describe to ' + outputFile)
} else {
  console.log(JSON.stringify(version))
}
