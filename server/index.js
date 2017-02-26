// load developer environment variables from .env
require('dotenv').config({ silent: true })

// launch the API server
require('./server')

// load some mock data. TODO: remove this
require('./seeds/server.seed')
