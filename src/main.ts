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

    const issueType = payload.pull_request ? 'pull_request' : 'issue'
    const issuePayload = payload.pull_request ?? payload.issue

    if (!issuePayload?.body) {
      core.error('No issue/pull_request body found in the payload.')
      return
    }
    let metadata = parseMetadata(issuePayload.body)

    // notify issue opened when no metadata found even if another event
    if (!metadata) {
      core.info('No metadata found. Notify issue again and create metadata.')
      metadata = await notifyIssueOpen(issuePayload, oct, issueType)
    }

    if (github.context.eventName === 'issue_comment') {
      await notifyComment(payload, oct, issueType, metadata)
    } else if (github.context.eventName === 'pull_request_review_comment') {
      await notifyPullRequestReviewComment(payload, oct, metadata)
    } else if (github.context.eventName === 'issues') {
      if (payload.action === 'closed') {
        await notifySimpleMessage({
          payload,
          metadata,
          rawBody: `:white_check_mark: This issue has been closed.`
        })
      }
    } else if (github.context.eventName === 'pull_request') {
      if (payload.action === 'closed') {
        if (payload.pull_request?.merged) {
          await notifySimpleMessage({
            payload,
            metadata,
            rawBody: `:tada: This pull request has been merged.`,
            color: '#8256D0'
          })
        } else {
          await notifySimpleMessage({
            payload,
            metadata,
            rawBody: `:white_check_mark: This pull request has been closed`
          })
        }
      }
    }
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

type Payload = typeof github.context.payload
type Octokit = ReturnType<typeof github.getOctokit>

async function notifyPullRequestReviewComment(
  payload: Payload,
  oct: Octokit,
  metadata?: Metadata
) {
  if (!payload.comment) {
    core.error('No comment found in the payload.')
    return
  }
  if (!payload.pull_request?.body) {
    core.error('No pull_request found in the payload.')
    return
  }

  // get private image urls from github and upload to slack
  const comment = await oct.rest.pulls.getReviewComment({
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
    text: payload.comment.body.slice(0, 1000),
    headerProps: {
      sender: {
        login: payload.sender?.login ?? 'unknown',
        avatar_url: payload.sender?.avatar_url || ''
      },
      url: payload.pull_request?.html_url ?? '',
      title: payload.pull_request?.title ?? '',
      number: payload.pull_request?.number ?? 0
    }
  })

  if (metadata) {
    metadata = addCommentNotification(
      metadata,
      payload.comment.id,
      result.message
    )

    await saveMetadata({
      rawBody: payload.pull_request.body,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issueNumber: payload.pull_request.number,
      issueType: 'pull_request',
      metadata,
      octkit: oct
    })
  }
}

async function notifyComment(
  payload: Payload,
  oct: Octokit,
  issueType: 'issue' | 'pull_request',
  metadata?: Metadata
) {
  if (!payload.comment) {
    core.error('No comment found in the payload.')
    return
  }
  const issuePayload =
    issueType === 'pull_request' ? payload.pull_request : payload.issue
  if (!issuePayload?.body) {
    core.error('No issue/pull_request found in the payload.')
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
    text: payload.comment.body.slice(0, 1000),
    headerProps: {
      sender: {
        login: payload.sender?.login ?? 'unknown',
        avatar_url: payload.sender?.avatar_url || ''
      },
      url: issuePayload?.html_url ?? '',
      title: issuePayload?.title ?? '',
      number: issuePayload?.number ?? 0
    }
  })

  if (metadata) {
    metadata = addCommentNotification(
      metadata,
      payload.comment.id,
      result.message
    )

    await saveMetadata({
      rawBody: issuePayload.body,
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issueNumber: issuePayload.number,
      issueType,
      metadata,
      octkit: oct
    })
  }
}

async function notifySimpleMessage({
  payload,
  rawBody,
  metadata,
  color = '#808080'
}: {
  payload: Payload
  rawBody: string
  metadata?: Metadata
  color?: string
}): Promise<void> {
  await notify({
    color, // green
    rawBody,
    imageUrls: [],
    text: payload.pull_request?.title || payload.issue?.title || 'unknown',
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
}

async function notifyIssueOpen(
  payload: Payload['issue'] | Payload['pull_request'],
  oct: Octokit,
  issueType: 'issue' | 'pull_request' = 'issue'
): Promise<Metadata | undefined> {
  if (!payload?.body) {
    core.error('No issue body found in the payload.')
    return
  }

  let data:
    | {
        body_html?: string
        user?: {
          login: string
          avatar_url: string
        } | null
      }
    | undefined

  if (issueType === 'pull_request') {
    const pull = await oct.rest.pulls.get({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      pull_number: payload.number,
      headers: {
        accept: 'application/vnd.github.html+json'
      }
    })
    data = pull.data
  } else if (issueType === 'issue') {
    // get private image urls from github and upload to slack
    const issue = await oct.rest.issues.get({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issue_number: payload.number,
      headers: {
        accept: 'application/vnd.github.html+json'
      }
    })
    data = issue.data
  }

  if (!data) {
    throw new Error('Failed to fetch issue/pull request data from GitHub.')
  }

  const result = await notify({
    color: '#36a64f', // green
    rawBody: payload.body,
    imageUrls: extractImgSrc(data.body_html || ''),
    text: payload.title,
    headerProps: {
      sender: {
        login: data.user?.login ?? 'unknown',
        avatar_url: data.user?.avatar_url || ''
      },
      url: payload.html_url ?? '',
      title: payload.title ?? '',
      number: payload.number ?? 0
    }
  })

  const metadata = {
    version: '0.0.1',
    issue_notification: result.message,
    comment_notifications: {}
  }

  await saveMetadata({
    rawBody: payload.body,
    owner: github.context.repo.owner,
    repo: github.context.repo.repo,
    issueNumber: payload.number,
    issueType,
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
  text: string
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
    text: props.text,
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
