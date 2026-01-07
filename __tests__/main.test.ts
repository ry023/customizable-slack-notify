import {jest} from '@jest/globals'
import * as core from '../__fixtures__/core.js'
import * as github from '../__fixtures__/github.ts'

jest.unstable_mockModule('@actions/core', () => core)
jest.unstable_mockModule('@actions/github', () => github)

const {run} = await import('../src/main.js')

describe('main.ts', () => {
  beforeEach(() => {
    //github.getComment.mockImplementation(() =>
    //core.getInput.mockImplementation(() => '500')
  })

  afterEach(() => {
    jest.resetAllMocks()
  })

  it('output', async () => {
    await run()
  })
})
