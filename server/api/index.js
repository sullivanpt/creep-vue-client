'use strict'

const express = require('express')

const articles = require('./articles.controller')
const members = require('./members.controller')
const topics = require('./topics.controller')

const queryRouter = express.Router()
queryRouter.param('id', function (req, res, next, id) { // for parsing simple path params like /members/:id
  req.params.id = id
  next()
})
queryRouter.get('/articles', articles.index)
queryRouter.get('/members/:id', members.view)
queryRouter.get('/topics', topics.index)

const mutationRouter = express.Router()
mutationRouter.post('/articles', articles.create)

exports.queryRouter = queryRouter
exports.mutationRouter = mutationRouter
