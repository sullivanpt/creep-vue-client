import Vue from 'vue'
import Vuex from 'vuex'

import restApi from 'plugins/rest-api.js'

Vue.use(Vuex)

export default new Vuex.Store({
  state: {
    count: 0,
    posts: { /* [handle]: { post } */ }
  },
  getters: {
    count (state) {
      return state.count
    },
    firstPost (state) {
      return state.posts[Object.keys(state.posts)[0]]
    }
  },
  mutations: {
    increment (state) {
      state.count++
    },
    savePost (state, post) {
      Vue.set(state.posts, post.handle, post)
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
