import * as core from '@actions/core'
import * as github from '@actions/github'
import { WebClient } from '@slack/web-api'
import { extractImgSrc } from './extract.js'

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
    if (!payload.comment.body || payload.comment.body.trim() === '') {
      core.info('Comment body is empty. Nothing to post to Slack.')
      return
    }

    payload.sender

    const slackToken = core.getInput('slack-token')
    const slackChannel = core.getInput('slack-channel')

    const slackClient = new WebClient(slackToken)
    const postRes = await slackClient.chat.postMessage({
      channel: slackChannel,
      icon_emoji: ':github:',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: payload.comment.body || ''
          }
        },
        {
          type: 'context',
          elements: [
            {
              type: 'image',
              image_url: payload.sender?.avatar_url || '',
              alt_text: 'cute cat'
            },
            {
              type: 'mrkdwn',
              text: `*${payload.sender?.username || 'unknown'}* : <https://example.com|Issueタイトル #999>`
            }
          ]
        }
      ]
    })
    if (!postRes.ok) {
      throw new Error(`Slack API error: ${postRes.error}`)
    }

    // Download private images from github and upload to slack
    const oct = github.getOctokit(core.getInput('github-token'))
    const comment = await oct.rest.issues.getComment({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      comment_id: payload.comment.id,
      headers: {
        accept: 'application/vnd.github.html+json'
      }
    })

    const imgSrcs = extractImgSrc(comment.data.body_html || '')

    const imageBlobs = await Promise.all(
      imgSrcs.map(async (src) => {
        const res = await fetch(src)
        if (!res.ok) {
          throw new Error(`Failed to fetch image: ${src}`)
        }
        const buffer = await res.arrayBuffer()
        return { src, buffer: Buffer.from(buffer) }
      })
    )

    let fileIds: string[] = []
    for (const image of imageBlobs) {
      // image.srcから拡張子を取得
      const path = new URL(image.src).pathname
      const ext =
        path
          .substring(path.lastIndexOf('/') + 1)
          .split('.')
          .pop() || 'png'

      // start upload flow
      const uploadUrlRes = await slackClient.files.getUploadURLExternal({
        filename: `${payload.comment.id}.${ext}`,
        length: image.buffer.length
      })
      if (
        !uploadUrlRes.ok ||
        !uploadUrlRes.upload_url ||
        !uploadUrlRes.file_id
      ) {
        throw new Error(`Failed to get upload URL for image: ${image.src}`)
      }

      // upload image
      const uploadRes = await fetch(uploadUrlRes.upload_url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: image.buffer
      })
      if (!uploadRes.ok) {
        throw new Error(`Failed to upload image to Slack: ${image.src}`)
      }
      fileIds.push(uploadUrlRes.file_id)
    }

    // complete upload flow
    if (fileIds.length > 0) {
      const completeRes = await slackClient.files.completeUploadExternal({
        files: [{ id: fileIds[0] }, ...fileIds.slice(1).map((id) => ({ id }))],
        channel_id: slackChannel,
        thread_ts: postRes.ts
      })
      if (!completeRes.ok) {
        throw new Error(`Failed to complete file upload: ${completeRes.error}`)
      }
    }
  } catch (error) {
    core.setFailed((error as Error).message)
  }
}
