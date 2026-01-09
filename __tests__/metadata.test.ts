import {parseMetadata, addCommentNotification} from '../src/metadata.js'

describe('metadata.ts', () => {
  it('addCommentNotification', async () => {
    const metadata = {
      version: '0.0.1',
      issue_notification: {
        ts: '1767866372.518049',
        channel_id: 'C0000000000'
      },
      comment_notifications: {}
    }

    const updatedMetadata = addCommentNotification(
      metadata,
      123456,
      {
        ts: '1767867000.000000',
        channel_id: 'C0000000000'
      }
    )

    expect(updatedMetadata).toEqual({
      version: '0.0.1',
      issue_notification: {
        ts: '1767866372.518049',
        channel_id: 'C0000000000'
      },
      comment_notifications: {
        '123456': {
          ts: '1767867000.000000',
          channel_id: 'C0000000000'
        }
      }
    })
  })

  it('parseMetadata', async () => {
    const rawBody = `
some issue body text

<!-- customizable-slack-notify
{
  "version": "0.0.1",
  "issue_notification": {
    "ts": "1767866372.518049",
    "channel_id": "C0000000000"
  },
  "comment_notifications": {}
}
-->
    `

    const metadata = parseMetadata(rawBody)

    expect(metadata).toEqual({
      version: '0.0.1',
      issue_notification: {
        ts: '1767866372.518049',
        channel_id: 'C0000000000'
      },
      comment_notifications: {}
    })
  })
})
