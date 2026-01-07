export const context = {
  payload: {
    comment: {
      id: 100
    },
    repo: {
      owner: 'example',
      repo: 'example'
    }
  },
}

export const getComment = jest.fn()

export const getOctokit = () => ({
  rest: {
    issues: {
      getComment
    }
  }
})
