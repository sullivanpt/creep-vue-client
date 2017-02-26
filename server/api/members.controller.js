'use strict'

const httpErrors = require('http-errors')
const models = require('../models')

exports.view = function (req, res, next) {
  if (req.params.id === '@me') {
    res.json(req.member)
  } else {
    models.Member.getByHandle(req.params.id)
      .then(result => {
        if (!result) return next(httpErrors(404))
        res.json(result)
      })
      .catch(err => next(err))
  }
}
