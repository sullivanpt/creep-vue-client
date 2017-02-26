'use strict'

const logs = require('./logs')
const logger = logs.logger('server')

const fs = require('fs')
const path = require('path')
const httpErrors = require('http-errors')
const express = require('express')
const compression = require('compression')
const favicon = require('serve-favicon')
const helmet = require('helmet')
const cookieParser = require('cookie-parser')
const bodyParser = require('body-parser')
const serveStatic = require('serve-static')

// const { createServer } = require('http')

const session = require('./session')
const models = require('./models')
const api = require('./api')

const publicRoot = path.normalize(path.resolve(__dirname, './public'))
const PORT = process.env.PORT || 3000
// const WS_PORT = process.env.WS_PORT || PORT
const ROOT_URL = process.env.ROOT_URL || `http://localhost:${PORT}`
const SESSION_SECRET = process.env.SESSION_SECRET || 'keyboard-cat'

// pull in repository and build data for logging as written by bin/git-describe
const version = JSON.parse(fs.readFileSync(path.join(publicRoot, 'version.json')))

// test route response (designed to be safe in production)
function jsonCredentialsResponseHandler (req, res) {
  res.json({
    mutation: req.session.mutation,
    tracker: req.session.sub,
    handle: req.member.handle,
    rtm: (new Date()).toISOString(),
  })
}

var app = express()

// attach a unique logging ID to every request, and selectively log HTTP requests
app.use(logs.identifyRequest({}))
app.use(logs.connectLogger())

// configure some best practices, serve some default content
// trust X-Forwarded-* headers from our load balancer
app.enable('trust proxy')
app.use(helmet())
app.use(compression())

// serve up the static content unprotected and untracked (no session management)
app.use(favicon(path.join(publicRoot, 'favicon.ico')))
app.use(serveStatic(publicRoot))

// note: noCache prevents IE and Safari from caching any AJAX responses
// note: etag caching and 304s cause AJAX content issues on every browser except Chrome
app.disable('etag')
app.use(helmet.noCache())

// end point for feature testing (note: designed to be safe in production)
app.route('/test/error/400').get((req, res, next) => { next(httpErrors(400, 'error 400 test point')) })
app.route('/test/error/403').get((req, res, next) => { next(httpErrors(403, 'error 403 test point')) })

// TODO: protect against distributed brute force signature guessing; although not needed with a sufficiently random key.
// suggest "white-list" approach with limited new untrusted connections per time period.
// failing a JWT signature (not expiration) removes from whitelist.
// Interesting aside see https://community.risingstack.com/zeromq-node-js-cracking-jwt-tokens-part2/

// upgrade the request logging ID to show we are authenticating the session
app.use(logs.identifyRequest({ getTrustLevel () { return 'A' } }))

// all routes after this path require session tracking using cookies.
// the following creates a token to be returned the user agent as a cookie, if one doesn't exist.
// it is vulnerable to CSRF so only use it to authenticate nulli-potent routes (GET).
// note: technically "refresh" is a mutation, but it is limited in scope.
// associateAndRefresh adds req.session
// we add req.member
app.use(cookieParser())
app.use(session.routeAssociateAndRefresh({
  iss: ROOT_URL,
  secret: SESSION_SECRET,
  refreshMaxAge: 365 * 24 * 60 * 60 * 1000, // 1 year (i.e. forever, longer tracks the user agent longer)
  sessionMaxAge: 5 * 60 * 1000, // 5 minutes (shorter is better except server needs to see it before it expires)
  sessionEarlyRefresh: 1 * 60 * 1000, // 1 minute (should be shorter than sessionMaxAge)
  refreshSub: (req, prevSub) =>
    models.Member.findByTracker(prevSub)
      .then(member => {
        // lookup existing tracker. if it's null or purposely expired returned member will be null
        if (member) {
          logger.id(req).info(`returning tracker ${prevSub} as handle ${member.handle}`)
          return [ prevSub, member ]
        } else {
          // generate a short string that humans can use to help track a user on the site and in logs
          let sub = models.Member.generateTracker()
          logger.id(req).info(`new tracker ${sub}`)
          // create a new member here and associate with the new tracker
          return Promise.all([ sub, models.Member.insert(sub) ]) // force member promise to resolve
        }
      })
      .then(values => {
        req.member = values[1] // attach the member to the request
        return values[0] // returns prevSub or new sub back to session findSub
      })
}))

// upgrade the request logging ID to include the session and member handle
app.use(logs.identifyRequest({
  getTrustLevel () { return 'T' },
  getSessionId (req) { return req.session.sub }
}))

// these paths are effectively no-ops to allow web agent and AJAX session refresh
// TODO: consider option to only refresh session on these routes to simplify non browser jwt handling
app.route('/').get((req, res, next) => {
  res.sendFile(path.join(publicRoot, 'test.html'))
})
app.route('/api/refresh').get(jsonCredentialsResponseHandler)

// primary API query routes
app.use('/api', bodyParser.json(), api.queryRouter)

// any other GET requests are 404
app.route('*').get((req, res, next) => {
  next(httpErrors(404))
})

// all routes after this path require session tracking using double submit pattern on Authorization header
// we are much less vulnerable to CSRF so we can do mutations (POST, PUT, DELETE).
app.use(session.routeAuthenticateForMutation({
  iss: ROOT_URL,
  secret: SESSION_SECRET,
}))

// TODO: optionally update tracker's saved req.ip, userAgent, etc.

// end point for feature testing (note: designed to be safe in production)
app.route('/test/mutation').get(jsonCredentialsResponseHandler)

// TODO: authenticate for upgrading to sensitive routes and route handlers for same (protect with per member rate limit)

// primary API mutation routes
//   context: {
//     logId: req.logId,
//     session: req.session,
//     member: req.member,
//      models,
//    }
app.use('/api', bodyParser.json(), api.mutationRouter)

//
// error handlers must be last routes defined
//

// custom error for 401 and 403 and 404
app.use((err, req, res, next) => {
  if (!err || ![401, 403, 404].includes(err.status)) {
    return next(err)
  }
  res.status(err.status).json({ status: err.status, message: err.message })
})

// in development mode we can pretty print any uncaught errors
if (app.get('env') === 'development') {
  app.use(require('errorhandler')())
}

// start the server
let appServer = app.listen(PORT, () => logger.always(
  `API Server build ${version.raw} is now running on http://localhost:${PORT}`
))

/* FUTURE
// by default use the app server for WebSocket server for subscriptions too
// however, if WS_PORT differs then create a unique WebSocket server.
// Aside two servers complicates session cookie management, but we don't use cookies on the webSocket anyway to avoid CSRF
let websocketServer = appServer
if (WS_PORT !== PORT) {
  websocketServer = createServer((req, res) => {
    res.writeHead(404)
    res.end()
  })

  websocketServer.listen(WS_PORT, () => logger.always(
    `Websocket Server is now running on http://localhost:${WS_PORT}`
  ))
}
*/

// expose app (useful for integration and e2e testing)
exports.app = app
exports.appServer = appServer
// exports.websocketServer = websocketServer
