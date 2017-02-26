/**
 * Some mock seed data for developing the server against
 */
'use strict'

const logger = require('../logs').logger('seeds')

const _ = require('lodash')
const models = require('../models')

logger.always('Seeding models with sample data')

/**
 * Create mock text for article
 */
function mockText () {
  return _.times(8, models.Member.generateTracker).join(' ')
}

/**
 * Create a few members and articles
 */
let topic = models.Topic.getById('flame')
_.times(3, () => {
  models.Member.insert(models.Member.generateTracker())
    .then(member => {
      models.Article.insert(topic, { text: mockText() }, member)
    })
})
