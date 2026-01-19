import { parse } from 'yaml'

type UsersConfig = {
  users: { github: string; slack: string }[]
}

let usersConfig: UsersConfig

export function loadUsersConfig(rawYaml: string) {
  const conf = parse(rawYaml)

  // validate config
  if (
    !conf ||
    typeof conf !== 'object' ||
    !Array.isArray((conf as any).users) ||
    !(conf as any).users.every(
      (u: any) =>
        u &&
        typeof u === 'object' &&
        typeof u.github === 'string' &&
        typeof u.slack === 'string'
    )
  ) {
    throw new Error('Invalid users config')
  }

  usersConfig = conf as UsersConfig
}

export function toSlackMention(
  githubMention: string,
  useGithubIfNotFound: boolean = true
): string {
  const githubUser = githubMention.replace(/^@/, '')

  const user = usersConfig.users.find((u) => u.github === githubUser)
  if (user) {
    return `@${user.slack}`
  } else if (useGithubIfNotFound) {
    return githubMention
  } else {
    throw new Error(`No slack user found for github user: ${githubUser}`)
  }
}
