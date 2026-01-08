import * as core from '@actions/core'
import * as github from '@actions/github'
import {KnownBlock, Block, WebClient} from '@slack/web-api'
import {extractImgSrc} from './extract.js'
import {slackifyMarkdown} from 'slackify-markdown'
import {addCommentNotification, loadMetadata, Notification, saveMetadata} from './metadata.js'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const payload = github.context.payload
    const oct = github.getOctokit(core.getInput('github-token'))

    const sender = {login: payload.sender?.login ?? 'unknown', avatar_url: payload.sender?.avatar_url || ''}

    if (!payload.issue) return
    let metadata = await loadMetadata({
      owner: github.context.repo.owner,
      repo: github.context.repo.repo,
      issueNumber: payload.issue.number,
      octkit: oct
    })

    if (github.context.eventName === 'issue_comment') {
      if (!payload.comment) return

      // get private image urls from github and upload to slack
      const comment = await oct.rest.issues.getComment({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        comment_id: payload.comment.id,
        headers: {
          accept: 'application/vnd.github.html+json'
        }
      })

      const result = await notify({
        rawBody: payload.comment.body ?? '',
        imageUrls: extractImgSrc(comment.data.body_html || ''),
        color: '#808080',
        headerProps: {
          sender,
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
          owner: github.context.repo.owner,
          repo: github.context.repo.repo,
          issueNumber: payload.issue.number,
          metadata,
          octkit: oct
        })
      }
    } else if (github.context.eventName === 'issues') {
      let rawBody = ''
      let imageUrls: string[] = []
      let color = '#36a64f' // green

      rawBody = payload.issue.body ?? ''

      // get private image urls from github and upload to slack
      const issue = await oct.rest.issues.get({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issue_number: payload.issue.number,
        headers: {
          accept: 'application/vnd.github.html+json'
        }
      })
      imageUrls = extractImgSrc(issue.data.body_html || '')

      if (github.context.payload.action === 'opened') {
        color = '#36a64f' // green
      } else if (github.context.payload.action === 'closed') {
        if (rawBody === '') {
          rawBody = `:white_check_mark: This issue has been closed.`
        }
        color = '#808080'
      }

      const result = await notify({
        color,
        rawBody,
        imageUrls,
        headerProps: {
          sender,
          url: payload.issue?.html_url ?? '',
          title: payload.issue?.title ?? '',
          number: payload.issue?.number ?? 0
        }
      })

      metadata = {
        version: '0.0.1',
        issue_notification: result.message,
        comment_notifications: {}
      }
    }

    if (metadata) {
      await saveMetadata({
        owner: github.context.repo.owner,
        repo: github.context.repo.repo,
        issueNumber: payload.issue.number,
        metadata,
        octkit: oct
      })
    }
  } catch (error: any) {
    core.setFailed(error.message)
  }
}

type notifyProps = {
  rawBody: string
  imageUrls: string[]
  color: string
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
  const postRes = await slackClient.chat.postMessage({
    channel: slackChannel,
    blocks: createMessageHeader(props.headerProps),
    attachments: [
      {
        color: props.color,
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
        blocks: createMessageHeader(props.headerProps),
        thread_ts: postRes.ts
      })
      if (!completeRes.ok) {
        throw new Error(
          `Failed to complete file upload: ${completeRes.error}`
        )
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
