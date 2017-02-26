'use strict'

const models = require('../models')

exports.index = function (req, res, next) {
  return res.json({ data: models.Topic.find() })
}
