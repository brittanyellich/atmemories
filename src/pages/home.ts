import type { Status } from '#/db'
import { html } from '../lib/view'
import { shell } from './shell'

type Props = {
  posts: Array<{ post: Record<string, unknown>; years: number }>
  profile?: {
    displayName?: string
    did?: string
    avatar?: string
    handle?: string
  }
}

export function home(props: Props) {
  return shell({
    title: 'Home',
    content: content(props),
  })
}

function renderPost(
  post: Record<string, unknown>,
  years: number,
  profile: {
    displayName?: string
    did?: string
    avatar?: string
    handle?: string
  },
) {
  const text =
    typeof post?.value === 'object' &&
    post?.value !== null &&
    'text' in post.value
      ? String((post.value as { text: string }).text).replaceAll('\n', '<br/>')
      : ''
  const postLink =
    profile.handle && typeof post.uri === 'string'
      ? `https://bsky.app/profile/${profile.handle}/post/${post.uri.split('/').pop()}`
      : ''
  const intentText = encodeURIComponent(
    `${years} year${years > 1 ? 's' : ''} ago today\n\nCheck out your memories on ATRewind.com\n\n${postLink}`,
  )
  return `<div class="memory-card">
    <h2>${years} year${years > 1 ? 's' : ''} ago today</h2>
    <div class="post">
      <div class="post-avatar">
        ${
          profile.avatar
            ? `<img
              src="${profile.avatar}"
              alt="Avatar of ${profile.displayName || 'user'}"
            />`
            : `<div class="avatar-placeholder"></div>`
        }
      </div>
      <div class="post-content">
        <div class="post-header">
          <a
            href="${toBskyLink(profile.did || '')}"
            target="_blank"
            rel="noopener noreferrer"
            class="post-author"
            aria-label="View profile"
            >${profile.displayName || 'Unknown User'}</a
          >
          <span class="post-handle">@${profile.handle || 'No handle'}</span>
          <span>·</span>
          <span class="post-timestamp">${ts(post as Status)}</span>
        </div>
        <div>${text}</div>
      </div>
    </div>
    <div class="post-actions">
      <a href="https://bsky.app/intent/compose?text=${intentText}" class="post-button">Repost to Bluesky</a>
    </div>
  </div>`
}

function renderAllPosts(
  profile: {
    displayName?: string
    did?: string
    avatar?: string
    handle?: string
  },
  posts: { post: any; years: any }[],
) {
  return posts.length > 0
    ? posts.map(({ post, years }) => {
        return renderPost(post, years, profile)
      })
    : `<div>No posts found for today.</div>`
}

function renderPosts(profile: Props['profile'], posts: Props['posts']) {
  if (!profile) {
    return `<div class="session-form">
      <div><a href="/login">Log in</a> to set your status!</div>
      <div>
        <a href="/login" class="button">Log in</a>
      </div>
    </div>`
  }
  return `<form action="/logout" method="post" class="session-form">
      <div>Hi, <strong>${profile.displayName || 'friend'}</strong>.</div>
      <div>
        <button type="submit">Log out</button>
      </div>
    </form>
    <div>${renderAllPosts(profile, posts)}</div>`
}

function content({ profile, posts }: Props) {
  const renderedPosts = renderPosts(profile, posts)

  return html`<div id="root">
    <div class="error"></div>
    <div id="header">
      <h1>ATRewind</h1>
      <p>Your memories in the Atmosphere.</p>
    </div>
    <div class="container">
      <div class="card">${html([renderedPosts])}</div>
    </div>
  </div>`
}

function toBskyLink(did: string) {
  return `https://bsky.app/profile/${did}`
}

function ts(post: Record<string, unknown> | null) {
  const value = post?.value as { createdAt?: string } | undefined
  const createdAt = value?.createdAt ? new Date(value.createdAt) : undefined
  if (createdAt) return createdAt.toDateString()
  return ''
}
