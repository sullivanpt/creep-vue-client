'use strict'

const httpErrors = require('http-errors')
const models = require('../models')

exports.index = function (req, res, next) {
  models.Article.findByAuthor()
    .then(articles => {
      return res.json({ data: articles })
    })
  .catch(err => { next(err) })
}

exports.create = function (req, res, next) {
  const topic = models.Topic.getById(req.topicId)
  if (topic && req.data.text) {
    models.Article.insert(topic, req.data, req.member)
      .then(result => {
        return res.status(201).json(result)
      })
      .catch(err => { next(err) })
  } else {
    next(httpErrors(400))
  }
}
