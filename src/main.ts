import * as core from '@actions/core'
import * as github from '@actions/github'

/**
 * The main function for the action.
 *
 * @returns Resolves when the action is complete.
 */
export async function run(): Promise<void> {
  try {
    const payload = github.context.payload;

    if (!payload.comment) {
      core.info("This event does not contain a comment.");
      return;
    }

    const commentBody = payload.comment.body;
    const issueNumber = payload.issue?.number;
    const sender = payload.sender?.login;

    core.info(`Comment: ${commentBody}`);
    core.info(`Issue number: ${issueNumber}`);
    core.info(`Sender: ${sender}`);
  } catch (error) {
    core.setFailed((error as Error).message);
  }
}
