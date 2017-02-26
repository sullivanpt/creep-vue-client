/**
 * Session management - this is experimental and certainly not "best practices"
 *
 * Problem statement: new users should be identified and uniquely tracked in a transparent fashion without
 * any explicit account creation steps. Users can add traditional account features such as password log in
 * after they have built up a profile worth saving. Meanwhile the application attempts to link individual
 * user sessions to surface return vistors with the intent of automatically building public behavioral
 * profiles. Users with sufficient motivation can manually link previous user sessions; although care is
 * taken to surface misleading identity claims. The application also provides the ability to abandon an identity,
 * but at some level the new and old identities remain surfaced as being linked. In short we explicitly track
 * user agent sessions (trackers) and infer people (members) relations from these.
 * tracker is 1-1 to member, but a member is many-to-1 to tracker and multiple members can reference the same tracker.
 *
 * We will use three tokens to identify web user agents.
 * - "session token" - a less secure short life cookie used for all "typical" web requests
 * - "refresh token" - a more secure long life cookie to "pin" returning user identity used to grant new session tokens
 *
 * We further add scope to the session token for these additional permissions.
 * - "sensitive" - a less secure short life permission used for "sensitive" web requests (protected private data)
 * - "moderate" - a less secure short life permission used for "moderate" web requests (changing other's public data)
 *
 * We're still using httpOnly cookies to store long lived session identifier; hereafter the refresh token. The refresh
 * token will be somewhat protected from XSS but left purposely vulnerable to CSRF; the CSRF will be mitigated
 * by scoping the refresh token to only be used for refreshing the session token.
 * As an aside, non-web based clients should still be able to read the "httpOnly" refresh token.
 * To facilitate automatic refresh the session will be refreshed on any GET of the default content (index.html) as
 * well as an "/api/refresh" JSON endpoint provided for that purpose.  The refresh returns the session token as a
 * non-httpOnly cookie accessible to JS.
 * Because the cookie only contains an indirect "tracker ID" (instead of a direct user ID) we can revoke refresh
 * tokens by updating the tracker database, and referencing this database during "relatively" rare refresh events.
 * FUTURE: let user opt-in to long life cookie; in this case user must opt in before creating new content.
 *
 * We use a non-httpOnly cookie to store the short lived session identifier. Delivering these in
 * cookie form should help keep them unavailable to COR access.  These tokens are more susceptible to XSS and
 * we try to mitigate this by keeping their lifespan extremely short; as an aside, any XSS "loses the castle keys"
 * anyway. We mitigate CSRF against these short lived tokens in these ways:
 * - the cookies are only used directly for authentication on GET requests which are designed to be nulli-potent.
 * - the client copies the cookie contents to the Authorization header or GraphQL variables of the POST, PUT, DELETE
 *   request ("double submit pattern") to authenticate operations with side-effects. As an aside, GraphQL
 *   uses POST exclusively.  webSocket messages are authenticated on a per GraphQL subscribe message basis using
 *   an embedded sessionToken query variable.
 *
 * The session token is automatically refreshed when feasible as it nears it's expire time.  However, a SPA client making
 * AJAX infrequent requests may have proactively refresh the token or recover and try again on expiration.
 *
 * The sensitive scope must be manually granted and requires additional authentication (password) to be granted. A SPA
 * client is responsible for providing a "pleasant experience" around permission expiration and for not accidentally
 * keeping the sensitive permission or the secrets required to grant it available longer than needed.
 * Adding secondary authentication parameters is opt-in, the client should encourage adding it when sensitive data
 * is added to the user record.
 *
 * The implementation will use industry standard JWT "sessionless" token format with these fields:
 *   exp/iat/jti: typical usage; jti is unique across all types of tokens so we can keep analytics
 *   iss: server website URL (env.ROOT_URL)
 *   sub: unique user agent tracker ID; this value remains unchanged across refresh events
 *   scope: one of 'refresh' or 'session'. Or an array of 'session' plus 'sensitive' and or 'moderate'
 *
 * See https://www.npmjs.com/package/learn-json-web-tokens
 *
 * The session data is attached to the request as req.session fields:
 *   decoded: one of the decoded, validated and not revoked JWT tokens (refresh, session or sensitive)
 *   sub: copy of the token subject (decoded.sub)
 *   sensitive: token scope as flags (decoded.scope)
 *   moderate: token scope as flags (decoded.scope)
 *   mutation: true if the authentication is resistant to CSRF
 *
 * HISTORY:
 * Inspired by http://stackoverflow.com/q/39525320
 * We're not using express-jwt because it isn't friendly to our three token model or our GraphQL webSockets.
 * We're abandoning express-session (server side session database using httpOnly cookies) primarily because:
 * - webSocket support required copy-and-paste because express-session code is non-modular (we weren't' DRY)
 * - the session database is an extra concern we don't need to manage (can drop redis and still stay performant)
 * - SPA + GraphQL semantics seem to "push the session down into the model", so our "web session" is just a user ID
 */
'use strict'

const logger = require('./logs').logger('session')

const _ = require('lodash')
const uuidV4 = require('uuid/v4')
const httpErrors = require('http-errors')
const jsonWebToken = require('jsonwebtoken')

// RFC6265 compliant names. https://github.com/expressjs/cookie-session/issues/16
const cookieNames = {
  refresh: 'refresh.jwt',
  session: 'session.jwt',
}

/**
 * Helper to read and validate a jwt in the Authentication Bearer [jwt] header
 * callback done(err, decoded or null)
 */
function authenticateHeaderIfPresent (req, options, done) {
  if (!req.headers || !req.headers.authorization) {
    return done()
  }
  let [ scheme, jwt, ...rest ] = req.headers.authorization.split(' ')
  if (rest.length) {
    return done(httpErrors(401, 'credentials bad format'))
  }
  if (!/^Bearer$/i.test(scheme)) {
    return done(httpErrors(401, 'credentials bad scheme'))
  }
  jsonWebToken.verify(jwt, options.secret, {
    issuer: options.iss
  }, done)
}

/**
 * Helper to read and validate a jwt in a cookie
 * callback done(err, decoded or null)
 */
function authenticateCookie (req, name, options, done) {
  if (!req.cookies[name]) {
    return done()
  }
  let jwt = req.cookies[name]
  if (!jwt) {
    return done(httpErrors(401, 'credentials required'))
  }
  jsonWebToken.verify(jwt, options.secret, {
    issuer: options.iss
  }, done)
}

/**
 * Helper to create a new refresh jwt and return it in a cookie
 * callback done(err, jwt)
 */
function newRefreshCookie (req, res, sub, options, done) {
  jsonWebToken.sign({
    jti: uuidV4(),
    iss: options.iss,
    sub,
    scope: 'refresh',
  }, options.secret, {
    expiresIn: Math.floor(options.refreshMaxAge / 1000), // TODO: probably should fudge edge case so cookie expires before jwt
  }, (err, jwt) => {
    if (err) {
      return done(err)
    }
    res.cookie(cookieNames.refresh, jwt, {
      httpOnly: true,
      secure: req.secure, // 'auto' flag using app.get('trust proxy')
      maxAge: options.refreshMaxAge, // TODO: consider browser session only until user opts in to cookies
    })
    done(null, jwt)
  })
}

/**
 * Helper to create a new session jwt and return it in a cookie
 * callback done(err, jwt)
 */
function newSessionCookie (req, res, sub, options, done) {
  jsonWebToken.sign({
    jti: uuidV4(),
    iss: options.iss,
    sub,
    scope: 'session',
  }, options.secret, {
    expiresIn: Math.floor(options.sessionMaxAge / 1000),
  }, (err, jwt) => {
    if (err) {
      return done(err)
    }
    res.cookie(cookieNames.session, jwt, {
      httpOnly: false,
      secure: req.secure, // 'auto' flag using app.get('trust proxy')
    })
    done(null, jwt)
  })
}

/**
 * Helper to call both newRefreshCookie and newSessionCookie then callback with the new session jwt
 * callback next(err, sessionJwt)
 */
function newRefreshAndSessionCookie (req, res, sub, options, done) {
  newRefreshCookie(req, res, sub, options, (err /* , jwt */) => {
    if (err) {
      return done(err)
    }
    newSessionCookie(req, res, sub, options, done)
  })
}

/**
 * Helper returns true if token is nearing time it will expire
 */
function almostExpired (decoded, options) {
  return Math.floor((Date.now() + options.sessionEarlyRefresh) / 1000) >= decoded.exp
}

/**
 * Helper to promote portions of decoded JWT to the session object
 * Promotes sub and scope
 */
function promoteDecodedToSession (decoded) {
  let result = { sub: decoded.sub }
  let scopeArray = _.isArray(decoded.scope) ? decoded.scope : [decoded.scope];
  [ 'sensitive', 'moderate' ].forEach((permission) => {
    if (scopeArray.includes(permission)) {
      result[permission] = true
    }
  })
  return result
}

/**
 * Assumes cookie-parser has already been applied.
 *
 * TODO: this is ridiculously complex and probably for no good reason, it's not native client friendly. maybe better to:
 * - just use Authorize header (session jwt) if present and valid and not revoked: fail on error
 * - just use refresh jwt cookie if present and valid and not revoked: create new refresh and session cookies on error
 * then if we're on "refresh route" (options.refresh) then follow up
 * - if session jwt cookie is present and valid and matches validSub and not expiring soon do nothing
 * - otherwise create new session jwt cookie: use it as req session jwt
 *
 * options:
 *   iss: ROOT_URL,
 *   secret: SESSION_SECRET,
 *   refreshMaxAge: 365 * 24 * 60 * 60 * 1000, // 1 year (i.e. forever, longer tracks the user agent longer)
 *   sessionMaxAge: 5 * 60 * 1000, // 5 minutes (shorter is better except server needs to see it before it expires)
 *   sessionEarlyRefresh: 1 * 60 * 1000, // 1 minute (should be shorter than sessionMaxAge)
 *   refreshSub: (req, prevSub) => Promise.resolve(0)
 */
function routeAssociateAndRefresh (options) {
  return function doRouteAssociateAndRefresh (req, res, next) {
    /**
     * Helper to handle cases where no previous session existed or previous session was revoked.
     * New validSub has already been created, we need to create tokens and cookies for it
     */
    function nextWithNewSession (validSub) {
      newRefreshAndSessionCookie(req, res, validSub, options, (err, jwt) => {
        if (err) {
          return next(err) // pass fatal error
        }
        req.session.decoded = jsonWebToken.decode(jwt)
        _.extend(req.session, promoteDecodedToSession(req.session.decoded))
        next()
      })
    }

    /**
     * Helper to handle cases where previous session existed, was valid, and was not revoked.
     * Includes aggressively updating the session cookie if the refresh cookie was present (indicating cookies in requests)
     * The decoded.sub has already been attached
     */
    function nextWithExistingSession (decoded) {
      _.extend(req.session, promoteDecodedToSession(decoded), { decoded })
      if (!req.cookies[cookieNames.refresh]) {
        // if refresh cookie not present then assume no point in looking if session cookie was valid as
        // this probably indicates session was used in AJAX authorization and cookies are not being used
        return next()
      }
      if (req.session.decoded.scope !== 'refresh') { // i.e. scope === 'session' or scope.contains('session')
        if (!almostExpired(req.session.decoded, options.sessionEarlyRefresh)) {
          // if session token supplied and valid and not nearly expired then we don't refresh it yet
          return next()
        } else {
          // session token supplied and valid and nearly expired so lets refresh it
          return authenticateCookie(req, cookieNames.refresh, options, (err, refreshDecoded) => {
            logger.id(req).debug('jwt cookie %s %j', cookieNames.refresh, err || decoded)
            if (err || req.session.sub !== _.get(refreshDecoded, 'sub')) {
              // refresh token available and invalid or for different subject, so the supplied session token is now suspect. throw it out
              req.session = {} // discard previous authentication
              next(err || httpErrors(401, 'credentials mismatch'))
            }
            // refresh token is available and valid. go ahead and refresh session
            newSessionCookie(req, res, req.session.sub, options, (err, jwt) => next(err))
          })
        }
      } else if (req.session.decoded.scope === 'refresh') {
        // refresh token supplied and valid, need to load session token
        return authenticateCookie(req, cookieNames.session, options, (err, sessionDecoded) => {
          logger.id(req).debug('jwt cookie %s %j', cookieNames.session, err || decoded)
          if (!err &&
            sessionDecoded &&
            sessionDecoded.sub === req.session.sub &&
            !almostExpired(sessionDecoded, options.sessionEarlyRefresh)) {
              // if session token cookie available and valid and not nearly expired then we don't refresh it yet
            return next()
          }
          // session token cookie either missing or invalid
          newSessionCookie(req, res, req.session.sub, options, (err, jwt) => next(err))
        })
      } else {
        // some other token supplied; shouldn't happen
        next()
      }
    }

    /**
     * doRouteAssociateAndRefresh code entry is here
     */
    req.session = req.session || {}
    if (req.session.sub) {
      return next() // already authorized
    }
    return authenticateHeaderIfPresent(req, options, (err, decoded) => {
      logger.id(req).debug('jwt header %j', err || decoded)
      if (err) {
        return next(err) // pass fatal error
      }
      if (decoded) {
        // authorize header session jwt was present and valid
        return options.refreshSub(req, decoded.sub)
          .then(validSub => {
            if (validSub === decoded.sub) {
              // authorize header session jwt was present and valid and not revoked
              req.session.mutation = true
              return nextWithExistingSession(decoded)
            } else {
              // authorize header session jwt was present and valid but was revoked. must generate new refresh and session tokens
              return nextWithNewSession(validSub)
            }
          })
          .catch(reason => next(reason)) // pass fatal error
      } else {
        // authorize header session jwt not present. use the refresh cookie
        return authenticateCookie(req, cookieNames.refresh, options, (err, decoded) => {
          logger.id(req).debug('jwt cookie %s %j', cookieNames.refresh, err || decoded)
          if (err) {
            return next(err) // pass fatal error
          }
          // refresh cookie missing or refresh cookie present and valid
          return options.refreshSub(req, _.get(decoded, 'sub'))
            .then(validSub => {
              if (validSub === _.get(decoded, 'sub')) {
                // refresh cookie present and valid and not revoked
                return nextWithExistingSession(decoded)
              } else {
                // refresh cookie was present and valid but was revoked. must generate new refresh and session tokens
                return nextWithNewSession(validSub)
              }
            })
            .catch(reason => next(reason)) // pass fatal error
        })
      }
    })
  }
}

/**
 * by default we're using Authorization header here and comparing jwt(bearer).sub against req.session.sub
 * options:
 *   iss: ROOT_URL
 *   secret: SESSION_SECRET
 */
function routeAuthenticateForMutation (options) {
  return function doRouteAuthenticateForMutation (req, res, next) {
    req.session = req.session || {}
    if (req.session.mutation) {
      return next() // already authorized for mutation
    }
    authenticateHeaderIfPresent(req, options, (err, decoded) => {
      if (err || !decoded) {
        return next(err || httpErrors(401, 'credentials required'))
      }
      if (req.session.sub !== decoded.sub) {
        // warning: this consisty check against jwt(req.cookies.find('session.jwt')).sub is trivial to fake client side
        return next(httpErrors(401, 'credentials mismatch'))
      }
      req.session.mutation = true
      return next()
    })
  }
}

/**
 * Resolves to decoded token.sub
 * options:
 *   iss: ROOT_URL,
 *   secret: SESSION_SECRET,
 *   jwtSession: params.jwt,
 *   wsReq, // optional, if present can be used for additional authentication (turtle32 websocket req, not an Express req!)
 */
function promiseAuthenticateForMutation (options) {
  return new Promise((resolve, reject) => {
    jsonWebToken.verify(options.jwtSession, options.secret, {
      issuer: options.iss
    }, (err, decoded) => {
      if (err) {
        return reject(err)
      }
      // TODO: consider verifying against jwt(wsReq.cookies.find('session.jwt')).sub
      return resolve(decoded.sub)
    })
  })
}

exports.routeAssociateAndRefresh = routeAssociateAndRefresh
exports.routeAuthenticateForMutation = routeAuthenticateForMutation
exports.promiseAuthenticateForMutation = promiseAuthenticateForMutation
