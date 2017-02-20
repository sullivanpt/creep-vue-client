import Vue from 'vue'
import Router from 'vue-router'
import Hello from 'components/Hello'
import UseApi from 'components/UseApi'

Vue.use(Router)

export default new Router({
  routes: [
    {
      path: '/',
      name: 'Hello',
      component: Hello
    },
    {
      path: '/use-api',
      name: 'UseApi',
      component: UseApi
    }
  ]
})
