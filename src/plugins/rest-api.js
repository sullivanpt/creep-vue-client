import axios from 'axios'

export default {
  fetchPostsFromapi () {
    return axios.get('/api/members/@me')
      .then(({ data }) => data)
  }
}
