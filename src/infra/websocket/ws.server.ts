import type { Server as HttpServer } from 'node:http'
import WebSocket, { WebSocketServer } from 'ws'
import type { StreamingSessionService } from '../../modules/streaming/services/application/streaming-session.service'

type LoggerLike = {
  info: (...a: any[]) => void
  warn: (...a: any[]) => void
  error: (...a: any[]) => void
}

export type WsGateway = {
  send: (sessionId: string, type: string, payload?: any) => void
}

type StartWsDeps = {
  sessions: StreamingSessionService
  stt: {
    pushAudio: (sessionId: string, chunk: Buffer) => Promise<void> | void
    stop?: (sessionId: string) => Promise<void> | void
  }
  logger: LoggerLike
}

type TwilioStartEvent = {
  event: 'start'
  streamSid?: string
  start?: {
    streamSid?: string
    customParameters?: Record<string, string>
  }
}

type TwilioMediaEvent = {
  event: 'media'
  streamSid?: string
  media?: {
    payload?: string
  }
}

type TwilioStopEvent = {
  event: 'stop'
  streamSid?: string
}

type TwilioAnyEvent = TwilioStartEvent | TwilioMediaEvent | TwilioStopEvent | Record<string, any>

function rawDataToString(raw: WebSocket.RawData): string | null {
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  return null
}

function safeJsonParse(raw: WebSocket.RawData, logger: LoggerLike): TwilioAnyEvent | null {
  const s = rawDataToString(raw)
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch (err) {
    logger.warn('[WS MEDIA] JSON parse error', err)
    return null
  }
}

function getStartStreamSid(msg: TwilioAnyEvent): string {
  return String((msg as any)?.start?.streamSid ?? (msg as any)?.streamSid ?? '')
}

function getStartSessionId(msg: TwilioAnyEvent): string {
  const custom = (msg as any)?.start?.customParameters ?? {}
  return String(custom?.sessionId ?? '')
}

function getMediaPayloadBase64(msg: TwilioAnyEvent): string {
  return String((msg as any)?.media?.payload ?? '')
}

function getStreamSid(msg: TwilioAnyEvent): string {
  return String((msg as any)?.streamSid ?? '')
}

async function handleTwilioStart(params: {
  msg: TwilioAnyEvent
  ws: WebSocket
  sessions: StreamingSessionService
  streamToSession: Map<string, string>
  logger: LoggerLike
}): Promise<{ streamSid: string; sessionId: string } | null> {
  const { msg, ws, sessions, streamToSession, logger } = params

  const streamSid = getStartStreamSid(msg)
  const sessionId = getStartSessionId(msg)

  if (!streamSid || !sessionId) {
    logger.warn('[WS MEDIA] start missing streamSid/sessionId', msg)
    ws.close(1008, 'Missing streamSid/sessionId')
    return null
  }

  if (!sessions.get(sessionId)) {
    logger.warn(`[WS MEDIA] invalid sessionId=${sessionId}`)
    ws.close(1008, 'Invalid sessionId')
    return null
  }

  streamToSession.set(streamSid, sessionId)
  logger.info(`[WS MEDIA] start streamSid=${streamSid} sessionId=${sessionId}`)
  return { streamSid, sessionId }
}

async function handleTwilioMedia(params: {
  msg: TwilioAnyEvent
  streamSid: string | null
  sessionId: string | null
  streamToSession: Map<string, string>
  stt: StartWsDeps['stt']
  logger: LoggerLike
}): Promise<{ streamSid: string | null; sessionId: string | null }> {
  const { msg, streamSid, sessionId, streamToSession, stt, logger } = params

  const payloadB64 = getMediaPayloadBase64(msg)
  if (!payloadB64) return { streamSid, sessionId }

  // resolver streamSid/sessionId si no llegaron aún
  const sidFromMsg = getStreamSid(msg)
  const effectiveStreamSid = streamSid || sidFromMsg || null
  const effectiveSessionId =
    sessionId || (effectiveStreamSid ? streamToSession.get(effectiveStreamSid) ?? null : null)

  if (!effectiveSessionId) return { streamSid: effectiveStreamSid, sessionId: effectiveSessionId }

  try {
    // Twilio manda mulaw 8k en base64 -> se envía tal cual a Deepgram con encoding=mulaw
    const audio = Buffer.from(payloadB64, 'base64')
    await stt.pushAudio(effectiveSessionId, audio)
  } catch (err) {
    logger.warn('[WS MEDIA] failed to push audio', err)
  }

  return { streamSid: effectiveStreamSid, sessionId: effectiveSessionId }
}

async function handleTwilioStop(params: {
  msg: TwilioAnyEvent
  streamSid: string | null
  sessionId: string | null
  streamToSession: Map<string, string>
  stt: StartWsDeps['stt']
  logger: LoggerLike
}): Promise<void> {
  const { msg, streamSid, sessionId, streamToSession, stt, logger } = params

  const sid = getStreamSid(msg) || streamSid || ''
  const sess = (sid ? streamToSession.get(sid) : null) || sessionId || null

  if (sid) streamToSession.delete(sid)
  if (sess && stt.stop) await stt.stop(sess)

  logger.info(`[WS MEDIA] stop streamSid=${sid} sessionId=${sess}`)
}

function createGateway(sessions: StreamingSessionService): WsGateway {
  return {
    send(sessionId: string, type: string, payload?: any) {
      const s: any = sessions.get(sessionId)
      const ws = s?.wsPanel as WebSocket | undefined
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      ws.send(JSON.stringify({ type, payload }))
    },
  }
}

function registerPanelWs(params: {
  httpServer: HttpServer
  sessions: StreamingSessionService
  logger: LoggerLike
}) {
  const { httpServer, sessions, logger } = params
  const wssPanel = new WebSocketServer({ server: httpServer, path: '/ws/panel' })

  wssPanel.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', `http://${req.headers.host}`)
    const sessionId = url.searchParams.get('sessionId') ?? ''
    if (!sessionId) return ws.close(1008, 'Missing sessionId')

    const s = sessions.setPanelSocket(sessionId, ws as any)
    if (!s) return ws.close(1008, 'Invalid sessionId')

    ws.send(JSON.stringify({ type: 'SESSION_STARTED', payload: { sessionId, callId: s.callId } }))

    ws.on('error', (err) => logger.warn(`[WS PANEL] error sessionId=${sessionId}`, err))
    ws.on('close', () => logger.info(`[WS PANEL] disconnected sessionId=${sessionId}`))
  })
}

function registerMediaWs(params: {
  httpServer: HttpServer
  sessions: StreamingSessionService
  stt: StartWsDeps['stt']
  logger: LoggerLike
}) {
  const { httpServer, sessions, stt, logger } = params
  const wssMedia = new WebSocketServer({ server: httpServer, path: '/ws/media' })
  const streamToSession = new Map<string, string>()

  wssMedia.on('connection', (ws) => {
    let streamSid: string | null = null
    let sessionId: string | null = null

    ws.on('message', async (raw) => {
      const msg = safeJsonParse(raw, logger)
      if (!msg) return

      const event = String((msg as any).event ?? '')

      if (event === 'start') {
        const startRes = await handleTwilioStart({ msg, ws, sessions, streamToSession, logger })
        if (!startRes) return
        streamSid = startRes.streamSid
        sessionId = startRes.sessionId
        return
      }

      if (event === 'media') {
        const res = await handleTwilioMedia({
          msg,
          streamSid,
          sessionId,
          streamToSession,
          stt,
          logger,
        })
        streamSid = res.streamSid
        sessionId = res.sessionId
        return
      }

      if (event === 'stop') {
        await handleTwilioStop({ msg, streamSid, sessionId, streamToSession, stt, logger })
        return
      }

      logger.warn('[WS MEDIA] unknown event', msg)
    })

    ws.on('close', async () => {
      // limpieza defensiva
      if (streamSid) streamToSession.delete(streamSid)
      if (sessionId && stt.stop) await stt.stop(sessionId)
    })

    ws.on('error', (err) => logger.warn('[WS MEDIA] error', err))
  })
}

export function startWebSocketServer(httpServer: HttpServer, deps: StartWsDeps): WsGateway {
  registerPanelWs({ httpServer, sessions: deps.sessions, logger: deps.logger })
  registerMediaWs({ httpServer, sessions: deps.sessions, stt: deps.stt, logger: deps.logger })
  deps.logger.info('WS Server started: /ws/panel and /ws/media')
  return createGateway(deps.sessions)
}
