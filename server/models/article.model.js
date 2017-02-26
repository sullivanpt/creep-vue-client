'use strict'

const logger = require('../logs').logger('article')

const { pubsub } = require('../subscriptions')

// TODO: replace this memory object with a DB
let articles = []

class Article {
  constructor (topic, text, author) {
    this.topic = topic
    this.text = text
    this.author = author
  }

  static insert (topic, data, author) {
    // TODO: any validations on data, rate limiting, etc.
    let result = new Article(topic, data.text, author)
    articles.push(result)
    logger.debug(`New article by member ${author.handle}`)
    pubsub.publish('articleAdded', result)
    return Promise.resolve(result)
  }

  static findByAuthor (author, topicId) {
    let result = articles.filter(article => (!author || article.author === author) && (!topicId || article.topic.id === topicId))
    return Promise.resolve(result)
  }
}

exports.Article = Article
