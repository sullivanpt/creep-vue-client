import axios from 'axios'

export default {
  fetchPostsFromapi () {
    return axios.get('/api/posts/1')
      .then(({ data }) => data)
  }
}
