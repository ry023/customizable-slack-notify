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

export function parseMetadata(rawBody: string): Metadata | undefined {
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
  rawBody: string
  metadata: Metadata
  octkit: ReturnType<typeof github.getOctokit>
  issueNumber: number
  issueType?: 'issue' | 'pull_request'
}

export async function saveMetadata(props: saveMetadataProps): Promise<void> {
  const {owner, repo, issueNumber, metadata, octkit, rawBody} = props

  // metadataを埋め込む
  const newBody = embedMetadata(rawBody, metadata)

  // issue bodyを更新
  if (props.issueType === 'pull_request') {
    await octkit.rest.pulls.update({
      owner,
      repo,
      pull_number: issueNumber,
      body: newBody
    })
  } else {
    await octkit.rest.issues.update({
      owner,
      repo,
      issue_number: issueNumber,
      body: newBody
    })
  }
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
