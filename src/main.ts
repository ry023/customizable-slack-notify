import * as core from '@actions/core'
import * as github from '@actions/github'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const payload = github.context.payload

    if (!payload.comment) {
      core.info('This event does not contain a comment.')
      return
    }

    const oct = github.getOctokit(core.getInput('github-token'))
    const comment = await oct.rest.issues.getComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: payload.comment.id,
      headers: {
        accept: 'application/vnd.github.html+json'
      }
    })

    core.info(`Comment body: ${comment.data.body}`)
    core.info(`Comment body_html: ${comment.data.body_html}`)



    //const slackToken = core.getInput('slack-token')
    //const slackChannel = core.getInput('slack-channel')

    //const res = await fetch('https://slack.com/api/chat.postMessage', {
    //  method: 'POST',
    //  headers: {
    //    Authorization: `Bearer ${slackToken}`,
    //    'Content-Type': 'application/json; charset=utf-8'
    //  },
    //  body: JSON.stringify({
    //    channel: slackChannel,
    //    text: `test message: ${comment.data.body_html}`
    //  })
    //})
    //core.info(`Slack response status: ${res.status}`)
    //core.info(`Slack response body: ${await res.text()}`)
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}

function extractImgSrc(html: string): string[] {
  const imgSrcs: string[] = []
  const imgTagRegex = /<img [^>]*src="([^"]+)"[^>]*>/g
  let match: RegExpExecArray | null

  while ((match = imgTagRegex.exec(html)) !== null) {
    imgSrcs.push(match[1])
  }

  return imgSrcs
}
