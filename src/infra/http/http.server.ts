import http, { type IncomingMessage, type Server } from 'node:http'
import type { Duplex } from 'node:stream'
import app from '../../app'
import logger from '../../shared/logger'

function firstHeaderValue(v: string | string[] | undefined): string | undefined {
  if (typeof v === 'string') return v
  if (Array.isArray(v)) return v[0]
  return undefined
}

function getHeader(req: IncomingMessage, name: string): string | undefined {
  return firstHeaderValue(req.headers[name.toLowerCase()])
}

function getClientIp(req: IncomingMessage): string | undefined {
  const cf = getHeader(req, 'cf-connecting-ip')
  if (cf) return cf

  const xff = getHeader(req, 'x-forwarded-for')
  if (xff) return xff.split(',')[0]?.trim()

  return req.socket.remoteAddress ?? undefined
}

function safeRemoteAddress(socket: Duplex): string | undefined {
  const anySocket = socket as unknown as { remoteAddress?: string }
  return anySocket.remoteAddress
}

export function createHttpServer(): Server {
  const server = http.createServer((req, res) => {
    const startedAt = Date.now()

    const method = req.method ?? 'GET'
    const url = req.url ?? '/'
    const ip = getClientIp(req)
    const ua = getHeader(req, 'user-agent') ?? null

    res.on('finish', () => {
      logger.info('[HTTP] request', {
        method,
        url,
        statusCode: res.statusCode,
        ms: Date.now() - startedAt,
        ip: ip ?? null,
        ua,
      })
    })

    req.on('aborted', () => {
      logger.warn('[HTTP] aborted', {
        method,
        url,
        ms: Date.now() - startedAt,
        ip: ip ?? null,
        ua,
      })
    })

    app(req, res)
  })

  server.on('upgrade', (req, socket) => {
    const url = req.url ?? null
    const ip = getClientIp(req) ?? safeRemoteAddress(socket) ?? null

    logger.info('[HTTP] upgrade', {
      url,
      host: getHeader(req, 'host') ?? null,
      upgrade: getHeader(req, 'upgrade') ?? null,
      connection: getHeader(req, 'connection') ?? null,
      secWsKey: getHeader(req, 'sec-websocket-key') ?? null,
      secWsVersion: getHeader(req, 'sec-websocket-version') ?? null,
      cfRay: getHeader(req, 'cf-ray') ?? null,
      ip,
      ua: getHeader(req, 'user-agent') ?? null,
    })

    socket.on('error', (err) => {
      logger.warn('[HTTP] upgrade_socket_error', {
        url,
        ip,
        errorName: err instanceof Error ? err.name : 'Error',
        errorMessage: err instanceof Error ? err.message : String(err),
      })
    })
  })

  server.on('error', (err) => {
    logger.error('[HTTP] server_error', {
      errorName: err instanceof Error ? err.name : 'Error',
      errorMessage: err instanceof Error ? err.message : String(err),
      errorStack: err instanceof Error ? err.stack : undefined,
    })
    process.exit(1)
  })

  server.on('listening', () => {
    const addr = server.address()
    const bind = typeof addr === 'string' ? `pipe ${addr}` : `port ${addr?.port}`
    logger.info('[HTTP] listening', { bind })
  })

  return server
}
