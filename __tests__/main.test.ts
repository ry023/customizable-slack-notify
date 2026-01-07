import {jest} from '@jest/globals'
import * as core from '../__fixtures__/core.js'

jest.unstable_mockModule('@actions/core', () => core)

jest.unstable_mockModule('@actions/github', () => ({
  context: {
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
}))

const {run} = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    //core.getInput.mockImplementation(() => '500')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('output', async () => {
    await run()
  })
})
