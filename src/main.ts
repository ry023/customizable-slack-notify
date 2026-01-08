import * as core from '@actions/core'
import * as github from '@actions/github'
import {KnownBlock, Block, WebClient} from '@slack/web-api'
import {extractImgSrc} from './extract.js'
import {slackifyMarkdown} from 'slackify-markdown'

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

    await notify({
      rawBody: comment.data.body ?? '',
      imageUrls: extractImgSrc(comment.data.body_html || ''),
      headerProps: {
        sender: {login: payload.sender?.lobin ?? 'unknown', avatar_url: payload.sender?.avatar_url || ''},
        url:
          payload.issue?.html_url ??
          payload.pull_request?.html_url ??
          '',
        title: payload.issue?.title ?? payload.pull_request?.title ?? 'unknown title',
        issue_number:
          payload.issue?.number ?? payload.pull_request?.number ?? 0
      }
    })
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

type notifyProps = {
  rawBody: string
  imageUrls: string[]
  headerProps: createMessageHeaderProps
}

async function notify(props: notifyProps): Promise<void> {
  const slackToken = core.getInput('slack-token')
  const slackChannel = core.getInput('slack-channel')
  const slackClient = new WebClient(slackToken)

  // post message
  const postRes = await slackClient.chat.postMessage({
    channel: slackChannel,
    blocks: createMessageHeader(props.headerProps),
    attachments: [
      {
        color: 'good',
        blocks: createMessageBody(props.rawBody)
      }
    ]
  })
  if (!postRes.ok) {
    throw new Error(`Slack API error: ${postRes.error}`)
  }

  if (props.imageUrls.length > 0) {
    const imageBlobs = await Promise.all(
      props.imageUrls.map(async (src) => {
        const res = await fetch(src)
        if (!res.ok) {
          throw new Error(`Failed to fetch image: ${src}`)
        }
        const buffer = await res.arrayBuffer()
        return {src, buffer: Buffer.from(buffer)}
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
        filename: `image.${ext}`,
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

    // complete image upload flow
    if (fileIds.length > 0) {
      const completeRes = await slackClient.files.completeUploadExternal({
        files: [
          {id: fileIds[0]},
          ...fileIds.slice(1).map((id) => ({id}))
        ],
        channel_id: slackChannel,
        thread_ts: postRes.ts
      })
      if (!completeRes.ok) {
        throw new Error(
          `Failed to complete file upload: ${completeRes.error}`
        )
      }
    }
  }
}

type createMessageHeaderProps = {
  sender: {
    login: string
    avatar_url: string
  }
  url: string
  title: string
  issue_number: number
}

function createMessageHeader(payload: createMessageHeaderProps): (KnownBlock | Block)[] {
  return [
    {
      type: 'context',
      elements: [
        {
          type: 'image',
          image_url: payload.sender?.avatar_url || '',
          alt_text: 'payload.sender.login'
        },
        {
          type: 'mrkdwn',
          text: `*${payload.sender?.login ?? 'unknown'}* : <${payload.url}|${payload.title} #${payload.issue_number}>`
        }
      ]
    }
  ]
}

function createMessageBody(rawBody: string): (KnownBlock | Block)[] {
  // imgタグを`(image)`に置換
  const imgTagRegex = /<img [^>]*src="[^"]*"[^>]*>/g
  let body = rawBody.replace(imgTagRegex, '[スレッドに画像を表示]')
  // markdownをslack形式に変換
  body = slackifyMarkdown(body)

  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: body
      }
    }
  ]
}
