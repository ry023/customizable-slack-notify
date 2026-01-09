import * as core from '@actions/core'
import * as github from '@actions/github'
import { KnownBlock, Block, WebClient } from '@slack/web-api'
import { extractImgSrc } from './extract.js'
import { slackifyMarkdown } from 'slackify-markdown'
import {
  addCommentNotification,
  parseMetadata,
  Notification,
  saveMetadata,
  Metadata
} from './metadata.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const payload = github.context.payload
    const oct = github.getOctokit(core.getInput('github-token'))

    if (!payload.issue?.body) {
      core.error('No issue body found in the payload.')
      return
    }
    core.info('raw issue body: ' + payload.issue.body)

    if (github.context.eventName === 'issue_comment') {
      let metadata = parseMetadata(payload.issue.body)
      if (!metadata) {
        core.info('No metadata found. Notify issue again and create metadata.')
        metadata = await notifyIssue(payload, oct)
      }
      await notifyComment(payload, oct, metadata)
    } else if (github.context.eventName === 'issues') {
      await notifyIssue(payload, oct)
    }
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

type Payload = typeof github.context.payload
type Octokit = ReturnType<typeof github.getOctokit>

async function notifyComment(
  payload: Payload,
  oct: Octokit,
  metadata?: Metadata
) {
  if (!payload.comment) {
    core.error('No comment found in the payload.')
    return
  }
  if (!payload.issue?.body) {
    core.error('No issue body found in the payload.')
    return
  }

  // get private image urls from github and upload to slack
  const comment = await oct.rest.issues.getComment({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    comment_id: payload.comment.id,
    headers: {
      accept: 'application/vnd.github.html+json'
    }
  })

  core.info('reply to thread_ts: ' + metadata?.issue_notification.ts)
  const result = await notify({
    rawBody: payload.comment.body ?? '',
    imageUrls: extractImgSrc(comment.data.body_html || ''),
    color: '#808080',
    thread_ts: metadata?.issue_notification.ts,
    headerProps: {
      sender: {
        login: payload.sender?.login ?? 'unknown',
        avatar_url: payload.sender?.avatar_url || ''
      },
      url: payload.issue?.html_url ?? '',
      title: payload.issue?.title ?? '',
      number: payload.issue?.number ?? 0
    }
  })

  if (metadata) {
    metadata = addCommentNotification(
      metadata,
      payload.comment.id,
      result.message
    )

    await saveMetadata({
      rawBody: payload.issue.body,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issueNumber: payload.issue.number,
      metadata,
      octkit: oct
    })
  }
}

async function notifyIssue(
  payload: Payload,
  oct: Octokit
): Promise<Metadata | undefined> {
  if (!payload.issue?.body) {
    core.error('No issue body found in the payload.')
    return
  }

  // get private image urls from github and upload to slack
  const issue = await oct.rest.issues.get({
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issue_number: payload.issue.number,
    headers: {
      accept: 'application/vnd.github.html+json'
    }
  })

  let color = '#36a64f' // green
  let rawBody = payload.issue.body ?? ''
  if (github.context.payload.action === 'closed') {
    if (rawBody === '') {
      rawBody = `:white_check_mark: This issue has been closed.`
    }
    color = '#808080' // gray
  }

  const result = await notify({
    color,
    rawBody,
    imageUrls: extractImgSrc(issue.data.body_html || ''),
    headerProps: {
      sender: {
        login: payload.sender?.login ?? 'unknown',
        avatar_url: payload.sender?.avatar_url || ''
      },
      url: payload.issue?.html_url ?? '',
      title: payload.issue?.title ?? '',
      number: payload.issue?.number ?? 0
    }
  })

  const metadata = {
    version: '0.0.1',
    issue_notification: result.message,
    comment_notifications: {}
  }

  await saveMetadata({
    rawBody: payload.issue.body,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issueNumber: payload.issue.number,
    metadata,
    octkit: oct
  })

  return metadata
}

type notifyProps = {
  rawBody: string
  imageUrls: string[]
  color: string
  thread_ts?: string
  headerProps: createMessageHeaderProps
}

type notifyResult = {
  message: Notification
  image?: Notification
}

async function notify(props: notifyProps): Promise<notifyResult> {
  const slackToken = core.getInput('slack-token')
  const slackChannel = core.getInput('slack-channel')
  const slackClient = new WebClient(slackToken)

  // post message
  const params = {
    channel: slackChannel,
    text: `(${props.headerProps.sender.login}/<${props.headerProps.url}|${props.headerProps.title.slice(0, 8)}>) ${props.rawBody.slice(0, 1000)}`,
    blocks: createMessageHeader(props.headerProps),
    attachments: [
      {
        color: props.color,
        blocks: createMessageBody(props.rawBody)
      }
    ]
  }
  const p =
    props.thread_ts !== undefined
      ? { ...params, thread_ts: props.thread_ts!, reply_broadcast: true }
      : params
  const postRes = await slackClient.chat.postMessage(p)
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
        files: [{ id: fileIds[0] }, ...fileIds.slice(1).map((id) => ({ id }))],
        channel_id: slackChannel,
        blocks: createMessageHeader(props.headerProps),
        thread_ts: props.thread_ts ?? postRes.ts
      })
      if (!completeRes.ok) {
        throw new Error(`Failed to complete file upload: ${completeRes.error}`)
      }
    }
  }

  return {
    message: {
      ts: postRes.ts,
      channel_id: slackChannel
    },
    image: {
      ts: postRes.ts,
      channel_id: slackChannel
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
  number: number
}

function createMessageHeader(
  payload: createMessageHeaderProps
): (KnownBlock | Block)[] {
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
          text: `*${payload.sender.login ?? 'unknown'}* : <${payload.url}|${payload.title} #${payload.number}>`
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
        text: body !== '' ? body : 'EMPTY COMMENT'
      }
    }
  ]
}
