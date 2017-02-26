/**
 * Consolidate log collection semantics in case we want to attach to log4js later.
 * Logger makes it easy to filter on:
 * - reqId:  unique ID for this HTTP request
 * - sessionId: unique ID for this user; in this case a JWT.sub/member.tracker
 * - trustLevel: untrusted/non-authenticated (U), trusted/authenticated (T), or authenticating (A)
 * - topic: server component name generating the message
 * - level: always/fatal/error/warn/info/debug/trace
 */
'use strict'

const _ = require('lodash')
const morgan = require('morgan')

/**
 * Represents the allowed logging severity levels.
 * note: 'none' maps to level 0
 */
const levelMap = {
  /**
   * informational messages that do not indicate an error but are needed to understand context such as "server starting"
   */
  always: 10,
  fatal: 20,
  error: 30,
  warn: 40,
  info: 50,
  debug: 60,
  trace: 70,
}

/**
 * messages with levels greater than levelFilter are elided
 */
let levelFilter = parseLevel(process.env.LOG_LEVEL ||
  (((process.env.NODE_ENV || '').trim() === 'test') ? 'none' : 'info'))

/**
 * Helper to convert a log level to an integer if it isn't already
 */
function parseLevel (level) {
  level = level.trim().toLowerCase()
  return (level === 'none') ? 0 : (levelMap[level] || parseInt(level))
}

/**
 * generate a short but statistically probably unique ID string. See http://stackoverflow.com/a/8084248
 */
function generateId () {
  return (Math.random() + 1).toString(36).substr(2, 5)
}

/**
 * Attach a unique log ID to an object as obj.logId = 'T RRRRR SSSSS'
 * Safe to call multiple times to change the trustLevel or sessionId
 * options {
 *   getTrustLevel(req) => 'U', 'T', 'A' or '-'
 *   getSessionId(req) => String or '-'
 * }
 */
function identifyObject (obj, options) {
  let [ trustLevel, reqId, sessionId ] = (obj.logId || '').split(' ')
  obj.logId = [
    options.getTrustLevel && options.getTrustLevel(obj) || trustLevel || 'U',
    reqId || generateId(),
    options.getSessionId && options.getSessionId(obj) || sessionId || '-',
  ].join(' ')
}
exports.identifyObject = identifyObject

/**
 * Middleware apply identifyObject on each request
 */
function identifyRequest (options) {
  return function identifyRequestHandler (req, res, next) {
    identifyObject(req, options)
    next()
  }
}
exports.identifyRequest = identifyRequest

/**
 * customized version of express morgan logger
 */
function connectLogger () {
  morgan.token('logid', req => req.logId)
  return morgan('ALWAYS [express] [:logid] :method :url :status :res[content-length] - :response-time ms', {
    skip (req) {
      // don't bother logging Untrusted requests unless LOG_LEVEL is trace. never log when it is none
      return (levelFilter <= levelMap.debug && (req.logId || '').split(' ')[0] === 'U') || !levelFilter
    }
  })
}
exports.connectLogger = connectLogger

/**
 * Log the given message if it pass the filtering criteria
 * Example: log('models', req, 'info', 'model is %j', obj)
 * logId can be string or object with string valued attribute 'logId'.
 */
function log (component, logId, level, format, ...args) {
  component = component || ''
  level = level || 'info'

  // TODO: add additional filtering here on component
  if (parseLevel(level) > levelFilter) {
    return
  }

  logId = _.get(logId, 'logId') || _.isString(logId) && logId || ''
  format = '%s [%s] [%s] ' + (format || '')
  console.log(format, level.toUpperCase(), component, logId, ...args)
}
exports.log = log

/**
 * Returns a logger for the topic
 * Example:
 * let logger = require('logs').logger('component')
 * logger.id(req).info('object %j', obj)
 * logger.info('object %j', obj)
 */
function logger (topic) {
  return _.reduce(levelMap, (total, value, key) => {
    total[key] = _.partial(log, topic, '', key)
    return total
  }, {
    id (logId) {
      return _.reduce(levelMap, (total, value, key) => {
        total[key] = _.partial(log, topic, logId, key)
        return total
      }, {})
    }
  })
}
exports.logger = logger
