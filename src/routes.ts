import { Agent } from '@atproto/api'
import { OAuthResolverError } from '@atproto/oauth-client-node'
import express from 'express'
import { getIronSession } from 'iron-session'
import type {
  IncomingMessage,
  RequestListener,
  ServerResponse,
} from 'node:http'
import path from 'node:path'

import type { AppContext } from '#/context'
import { env } from '#/env'
import { handler } from '#/lib/http'
import { ifString } from '#/lib/util'
import { page } from '#/lib/view'
import { home } from '#/pages/home'
import { login } from '#/pages/login'
// Max age, in seconds, for static routes and assets
const MAX_AGE = env.NODE_ENV === 'production' ? 60 : 0

type Session = { did?: string }

// Helper function to get the Atproto Agent for the active session
async function getSessionAgent(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: AppContext,
) {
  res.setHeader('Vary', 'Cookie')

  const session = await getIronSession<Session>(req, res, {
    cookieName: 'sid',
    password: env.COOKIE_SECRET,
  })
  if (!session.did) return null

  // This page is dynamic and should not be cached publicly
  res.setHeader('cache-control', `max-age=${MAX_AGE}, private`)

  try {
    const oauthSession = await ctx.oauthClient.restore(session.did)
    return oauthSession ? new Agent(oauthSession) : null
  } catch (err) {
    ctx.logger.warn({ err }, 'oauth restore failed')
    await session.destroy()
    return null
  }
}

export const createRouter = (ctx: AppContext): RequestListener => {
  const router = express()

  // Static assets
  router.use(
    '/public',
    express.static(path.join(__dirname, 'pages', 'public'), {
      maxAge: MAX_AGE * 1000,
    }),
  )

  // OAuth metadata
  router.get(
    '/oauth-client-metadata.json',
    handler((req, res) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`)
      res.json(ctx.oauthClient.clientMetadata)
    }),
  )

  // Public keys
  router.get(
    '/.well-known/jwks.json',
    handler((req, res) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`)
      res.json(ctx.oauthClient.jwks)
    }),
  )

  // OAuth callback to complete session creation
  router.get(
    '/oauth/callback',
    handler(async (req, res) => {
      res.setHeader('cache-control', 'no-store')

      const params = new URLSearchParams(req.originalUrl.split('?')[1])
      try {
        // Load the session cookie
        const session = await getIronSession<Session>(req, res, {
          cookieName: 'sid',
          password: env.COOKIE_SECRET,
        })

        // If the user is already signed in, destroy the old credentials
        if (session.did) {
          try {
            const oauthSession = await ctx.oauthClient.restore(session.did)
            if (oauthSession) oauthSession.signOut()
          } catch (err) {
            ctx.logger.warn({ err }, 'oauth restore failed')
          }
        }

        // Complete the OAuth flow
        const oauth = await ctx.oauthClient.callback(params)

        // Update the session cookie
        session.did = oauth.session.did

        await session.save()
      } catch (err) {
        ctx.logger.error({ err }, 'oauth callback failed')
      }

      return res.redirect('/')
    }),
  )

  // Login page
  router.get(
    '/login',
    handler(async (req, res) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`)
      res.type('html').send(page(login({})))
    }),
  )

  // Login handler
  router.post(
    '/login',
    express.urlencoded(),
    handler(async (req, res) => {
      // Never store this route
      res.setHeader('cache-control', 'no-store')

      // Initiate the OAuth flow
      try {
        // Validate input: can be a handle, a DID or a service URL (PDS).
        const input = ifString(req.body.input)
        if (!input) {
          throw new Error('Invalid input')
        }

        // Initiate the OAuth flow
        const url = await ctx.oauthClient.authorize(input, {
          scope: 'atproto transition:generic',
        })

        res.redirect(url.toString())
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed')

        const error = err instanceof Error ? err.message : 'unexpected error'

        return res.type('html').send(page(login({ error })))
      }
    }),
  )

  // Signup
  router.get(
    '/signup',
    handler(async (req, res) => {
      res.setHeader('cache-control', `max-age=${MAX_AGE}, public`)

      try {
        const service = env.PDS_URL ?? 'https://bsky.social'
        const url = await ctx.oauthClient.authorize(service, {
          scope: 'atproto transition:generic',
        })
        res.redirect(url.toString())
      } catch (err) {
        ctx.logger.error({ err }, 'oauth authorize failed')
        res.type('html').send(
          page(
            login({
              error:
                err instanceof OAuthResolverError
                  ? err.message
                  : "couldn't initiate login",
            }),
          ),
        )
      }
    }),
  )

  // Logout handler
  router.post(
    '/logout',
    handler(async (req, res) => {
      // Never store this route
      res.setHeader('cache-control', 'no-store')

      const session = await getIronSession<Session>(req, res, {
        cookieName: 'sid',
        password: env.COOKIE_SECRET,
      })

      // Revoke credentials on the server
      if (session.did) {
        try {
          const oauthSession = await ctx.oauthClient.restore(session.did)
          if (oauthSession) await oauthSession.signOut()
        } catch (err) {
          ctx.logger.warn({ err }, 'Failed to revoke credentials')
        }
      }

      session.destroy()

      return res.redirect('/')
    }),
  )

  // Homepage
  router.get(
    '/',
    handler(async (req, res) => {
      // If the user is signed in, get an agent which communicates with their server
      const agent = await getSessionAgent(req, res, ctx)
      const startOfDay = new Date()
      startOfDay.setFullYear(startOfDay.getFullYear() - 1)
      startOfDay.setHours(0, 0, 0, 0)
      const { create } = await import('@atcute/tid')
      const cursorStart = create(startOfDay.getTime() * 1000, 0)
      let posts: Array<{ post: Record<string, unknown>; years: number }> = []

      const records = await agent?.com.atproto.repo.listRecords({
        repo: agent.assertDid,
        collection: 'app.bsky.feed.post',
        limit: 10,
        cursor: cursorStart,
        reverse: true,
      })
      if (records) {
        const today = new Date()
        const todayStart = new Date(
          today.getFullYear() - 1,
          today.getMonth(),
          today.getDate(),
        ).getTime()
        const todayEnd = new Date(
          today.getFullYear() - 1,
          today.getMonth(),
          today.getDate() + 1,
        ).getTime()

        const postsToday = records.data.records.filter((record) => {
          const createdAt = new Date(
            record?.value?.createdAt as string,
          ).getTime()
          return createdAt >= todayStart && createdAt < todayEnd
        })
        if (postsToday.length > 1) {
          postsToday.sort((a, b) => {
            const aLikes = (a?.value?.likeCount as number) || 0
            const bLikes = (b?.value?.likeCount as number) || 0
            return bLikes - aLikes
          })
        }
        const bestPost = postsToday[0]

        if (bestPost) {
          posts = [
            { post: bestPost as unknown as Record<string, unknown>, years: 1 },
          ]
        }
      }

      if (!agent) {
        // Serve the logged-out view
        return res
          .type('html')
          .send(page(home({ posts: [], profile: undefined })))
      }

      // Fetch additional information about the logged-in user
      const profileResponse = await agent
        .getProfile({ actor: agent.assertDid })
        .catch(() => undefined)

      const profileData = profileResponse?.data

      const profile = profileData
        ? {
            displayName: profileData.displayName,
            handle: profileData.handle,
            did: profileData.did,
            avatar: profileData.avatar,
          }
        : undefined

      // Serve the logged-in view
      res.type('html').send(
        page(
          home({
            posts,
            profile,
          }),
        ),
      )
    }),
  )

  return router
}
