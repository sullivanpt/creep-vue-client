import Vue from 'vue'
import Vuex from 'vuex'

import restApi from 'plugins/rest-api.js'

Vue.use(Vuex)

export default new Vuex.Store({
  state: {
    count: 0,
    posts: { /* [id]: { post } */ }
  },
  getters: {
    count (state) {
      return state.count
    },
    firstPost (state) {
      return state.posts[1]
    }
  },
  mutations: {
    increment (state) {
      state.count++
    },
    savePost (state, post) {
      Vue.set(state.posts, post.id, post)
    }
  },
  actions: {
    fetchPosts (context) {
      return restApi.fetchPostsFromapi()
        .then(data => {
          context.commit('savePost', data)
        })
        .catch(err => {
          console.log('ajax error', err)
        })
    }
  }
})
