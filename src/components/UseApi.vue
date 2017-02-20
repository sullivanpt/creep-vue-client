<template>
  <div class="use-api">
    <div>the API: {{msg}}</div>
    <div>
      store: {{count}} 
      <button @click="increment">+</button>
      <br>
      post: {{firstPost}}
      <button @click="fetchPosts">fetch</button>
    </div>
  </div>
</template>

<script>
  import { mapGetters, mapMutations, mapActions } from 'vuex'

  export default {
    name: 'use-api',
    data () {
      return {
        msg: 'loading the API'
      }
    },
    created () {
      this.fetchPosts()
    },
    computed: {
      ...mapGetters([
        'count',
        'firstPost'
      ]),
      countAndOne () {
        return this.$store.getters.count
      }
    },
    methods: {
      ...mapMutations([
        'increment'
      ]),
      ...mapActions([
        'fetchPosts'
      ])
    }
  }
</script>

<style scoped></style>
