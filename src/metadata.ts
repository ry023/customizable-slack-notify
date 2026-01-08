type Metadata = {
  version: number
  issue_notify: {
    thread_ts?: string
    channel_id?: string
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
      console.warn('Failed to parse metadata JSON:', error)
      return undefined
    }
  }
}

export function embedMetadata(rawBody: string, metadata: Metadata): string {
  const metadataComment = `<!-- customizable-slack-notify\n${JSON.stringify(metadata, null, 2)}\n-->`

  // 既存のmetadataを置換、なければ末尾に追加
  const metadataRegex = /<!--\s*customizable-slack-notify\s*[\s\S]*?\s*-->/g
  if (metadataRegex.test(rawBody)) {
    return rawBody.replace(metadataRegex, metadataComment)
  } else {
    return `${rawBody}\n\n${metadataComment}`
  }
}
