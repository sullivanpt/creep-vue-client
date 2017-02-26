'use strict'

/**
 * Articles are siloed into top level topics separated by participant goal.
 * Goals might be, find a partner, learn something new, etc.
 * Goals are sufficiently different that different content expectations and surfacing rules are expected to apply.
 * Cross referencing topics is allowed but discouraged.
 *
 * no DB needed so no Promise. famous last words...
 */
class Topic {
  constructor (id, title, description, icon) {
    this.id = id
    this.title = title
    this.description = description
    this.icon = icon // TODO: how to handle icons? relative URL, CDN, app-local ID, ...
  }

  static getById (id) {
    return topics.find(topic => id === topic.id)
  }

  static find () {
    return topics
  }
}

// Implementation only needs a simple hard-coded list
let topics = [
  new Topic('learning', 'new renaissance', 'science, philosophy, and life long learning'),
  new Topic('politics', 'politics', 'discuss policy and public figures'),
  new Topic('website', 'this website', 'suggestions and improvements and technical support for this website'),
  new Topic('flame', 'creative criticism', 'constructively call out how other people might improve'),
]

exports.Topic = Topic
