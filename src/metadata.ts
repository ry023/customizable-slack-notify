import * as github from '@actions/github'
import * as core from '@actions/core'

export type Notification = {
  ts?: string
  channel_id?: string
}

export type Metadata = {
  version: string
  issue_notification: Notification
  comment_notifications: {
    [commentId: string]: Notification
  }
}

type loadMetadataProps = {
  owner: string
  repo: string
  issueNumber: number
  octkit: ReturnType<typeof github.getOctokit>
}

export function addCommentNotification(
  metadata: Metadata,
  commentId: number,
  notification: Notification
): Metadata {
  return {
    ...metadata,
    comment_notifications: {
      ...metadata.comment_notifications,
      [commentId]: notification
    }
  }
}

export async function loadMetadata(props: loadMetadataProps): Promise<Metadata | undefined> {
  const {owner, repo, issueNumber, octkit} = props

  // issue bodyを取得
  const {data: issue} = await octkit.rest.issues.get({
    owner,
    repo,
    issue_number: issueNumber,
    headers: {
      accept: 'application/vnd.github.html+json'
    }
  })

  const rawBody = issue.body || ''

  // metadataを抽出
  return parseMetadata(rawBody)
}

function parseMetadata(rawBody: string): Metadata | undefined {
  // <!-- customizable-slack-notify --> で囲まれたJSONを抽出
  const metadataRegex = /<!--\s*customizable-slack-notify\s*([\s\S]*?)\s*-->/g
  const match = metadataRegex.exec(rawBody)
  if (match && match[1]) {
    try {
      const metadata: Metadata = JSON.parse(match[1])
      return metadata
    } catch (error) {
      core.warning('Failed to parse metadata JSON')
      return undefined
    }
  }
}

type saveMetadataProps = {
  owner: string
  repo: string
  issueNumber: number
  rawBody: string
  metadata: Metadata
  octkit: ReturnType<typeof github.getOctokit>
}


export async function saveMetadata(
  props: saveMetadataProps
): Promise<void> {
  const {owner, repo, issueNumber, metadata, octkit, rawBody} = props

  // metadataを埋め込む
  const newBody = embedMetadata(rawBody, metadata)

  // issue bodyを更新
  await octkit.rest.issues.update({
    owner,
    repo,
    issue_number: issueNumber,
    body: newBody
  })
}

function embedMetadata(rawBody: string, metadata: Metadata): string {
  const metadataComment = `<!-- customizable-slack-notify\n${JSON.stringify(metadata, null, 2)}\n-->`

  // 既存のmetadataを置換、なければ末尾に追加
  const metadataRegex = /<!--\s*customizable-slack-notify\s*[\s\S]*?\s*-->/g
  if (metadataRegex.test(rawBody)) {
    return rawBody.replace(metadataRegex, metadataComment)
  } else {
    return `${rawBody}\n\n${metadataComment}`
  }
}
