import type { Server as HttpServer } from 'node:http'
import type net from 'node:net'
import WebSocket, { WebSocketServer } from 'ws'
import type { StreamingSessionService } from '../../modules/streaming/services/application/streaming-session.service'

type LoggerLike = {
  info: (...a: any[]) => void
  warn: (...a: any[]) => void
  error: (...a: any[]) => void
  debug?: (...a: any[]) => void
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

type TwilioWsEvent = {
  event?: string
  streamSid?: string
  start?: {
    streamSid?: string
    customParameters?: Record<string, string>
  }
  media?: {
    payload?: string
  }
  [k: string]: any
}

function bufToDebug(reason: Buffer | string | undefined) {
  if (reason == null) return { reasonStr: '', reasonLen: 0, reasonHex: '' }
  if (typeof reason === 'string') {
    return {
      reasonStr: reason,
      reasonLen: Buffer.byteLength(reason),
      reasonHex: Buffer.from(reason).toString('hex'),
    }
  }
  const b = Buffer.isBuffer(reason) ? reason : Buffer.from(String(reason))
  return {
    reasonStr: b.toString('utf8'),
    reasonLen: b.length,
    reasonHex: b.toString('hex'),
  }
}

function sockMeta(sock?: net.Socket | null) {
  if (!sock) return null
  return {
    destroyed: sock.destroyed,
    connecting: (sock as any).connecting ?? null,
    pending: (sock as any).pending ?? null,

    remoteAddress: sock.remoteAddress ?? null,
    remotePort: sock.remotePort ?? null,
    localAddress: sock.localAddress ?? null,
    localPort: sock.localPort ?? null,

    bytesRead: (sock as any).bytesRead ?? null,
    bytesWritten: (sock as any).bytesWritten ?? null,
    timeout: (sock as any).timeout ?? null,
  }
}

function errMeta(err: unknown) {
  const e = err instanceof Error ? err : new Error(String(err))
  return {
    errorName: e.name,
    errorMessage: e.message,
    errorStack: e.stack,
    errorCode: (e as any).code ?? null,
    errorErrno: (e as any).errno ?? null,
    errorSyscall: (e as any).syscall ?? null,
  }
}

function rawDataToString(raw: WebSocket.RawData): string | null {
  if (typeof raw === 'string') return raw
  if (Buffer.isBuffer(raw)) return raw.toString('utf8')
  if (Array.isArray(raw)) return Buffer.concat(raw).toString('utf8')
  if (raw instanceof ArrayBuffer) return Buffer.from(raw).toString('utf8')
  return null
}

function asError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err))
}

export function stripWsExtensionsHeader(
  wss: WebSocketServer,
  opts?: { enabled?: boolean; logger?: LoggerLike }
) {
  const logger = opts?.logger
  const enabled = opts?.enabled ?? false

  logger?.info?.('[WS][stripExt] init', { enabled })

  if (!enabled) {
    logger?.info?.('[WS][stripExt] disabled by config')
    return
  }

  const k = Symbol.for('ws.stripWsExtensionsHeader.attached')
  const anyWss = wss as any

  if (anyWss[k]) {
    logger?.warn?.('[WS][stripExt] already attached – skipping')
    return
  }
  anyWss[k] = true

  const getPerMessageDeflateValue = (): boolean | object | undefined => {
    const v =
      (anyWss.options?.perMessageDeflate as unknown) ??
      (anyWss._options?.perMessageDeflate as unknown)

    if (typeof v === 'boolean') return v
    if (v && typeof v === 'object') return v
    return undefined
  }

  const isPerMessageDeflateEnabled = (): boolean => {
    const v = getPerMessageDeflateValue()
    return v === true || (v != null && typeof v === 'object')
  }

  wss.on('headers', (headers: unknown) => {
    logger?.debug?.('[WS][stripExt] headers event fired')

    if (!Array.isArray(headers) || headers.length === 0) {
      logger?.warn?.('[WS][stripExt] headers empty or invalid')
      return
    }

    const pmdValue = getPerMessageDeflateValue()
    const pmdEnabled = isPerMessageDeflateEnabled()

    logger?.info?.('[WS][stripExt] perMessageDeflate state', {
      value: pmdValue,
      enabled: pmdEnabled,
    })

    if (pmdEnabled) {
      logger?.warn?.(
        '[WS][stripExt] skipping header stripping because perMessageDeflate is ENABLED'
      )
      return
    }

    let removed = 0

    for (let i = headers.length - 1; i >= 0; i--) {
      const h = headers[i]
      if (typeof h !== 'string') continue

      if (/^\s*sec-websocket-extensions\s*:/i.test(h)) {
        logger?.warn?.('[WS][stripExt] removing response header', { header: h })
        headers.splice(i, 1)
        removed++
      }
    }

    if (removed === 0) {
      logger?.warn?.('[WS][stripExt] no Sec-WebSocket-Extensions header found')
    } else {
      logger?.info?.('[WS][stripExt] headers stripped', { removed })
    }
  })
}

function closeWs(ws: WebSocket, code: number, reason: string) {
  try {
    ws.close(code, reason)
  } catch {}

  const t = setTimeout(() => {
    try {
      ws.terminate()
    } catch {}
  }, 20_000)

  ws.once('close', () => clearTimeout(t))
}

function safeJsonParse(raw: WebSocket.RawData, logger: LoggerLike): TwilioWsEvent | null {
  const s = rawDataToString(raw)
  if (!s) return null
  try {
    return JSON.parse(s) as TwilioWsEvent
  } catch (err) {
    const e = asError(err)
    logger.warn('[WS MEDIA] json_parse_error', { errorName: e.name, errorMessage: e.message })
    return null
  }
}

function isStartEvent(
  msg: TwilioWsEvent
): msg is TwilioWsEvent & { event: 'start'; start: NonNullable<TwilioWsEvent['start']> } {
  return msg.event === 'start'
}

function isMediaEvent(
  msg: TwilioWsEvent
): msg is TwilioWsEvent & { event: 'media'; media: NonNullable<TwilioWsEvent['media']> } {
  return msg.event === 'media'
}

function isStopEvent(msg: TwilioWsEvent): msg is TwilioWsEvent & { event: 'stop' } {
  return msg.event === 'stop'
}

function getStartStreamSid(msg: TwilioWsEvent): string {
  return String(msg.start?.streamSid ?? msg.streamSid ?? '')
}

function getStartSessionId(msg: TwilioWsEvent): string {
  const custom = msg.start?.customParameters ?? {}
  return String(custom.sessionId ?? '')
}

function getMediaPayloadBase64(msg: TwilioWsEvent): string {
  return String(msg.media?.payload ?? '')
}

function getStreamSid(msg: TwilioWsEvent): string {
  return String(msg.streamSid ?? '')
}

async function handleTwilioStart(params: {
  msg: TwilioWsEvent
  ws: WebSocket
  sessions: StreamingSessionService
  streamToSession: Map<string, string>
  logger: LoggerLike
  connId: string
}): Promise<{ streamSid: string; sessionId: string } | null> {
  const { msg, ws, sessions, streamToSession, logger, connId } = params

  const streamSid = getStartStreamSid(msg)
  const sessionId = getStartSessionId(msg)

  if (!streamSid || !sessionId) {
    logger.warn('[WS MEDIA] start_missing_ids', { connId, streamSid, sessionId })
    closeWs(ws, 1008, 'Missing streamSid/sessionId')
    return null
  }

  if (!sessions.get(sessionId)) {
    logger.warn('[WS MEDIA] start_invalid_session', { connId, sessionId, streamSid })
    closeWs(ws, 1008, 'Invalid sessionId')
    return null
  }

  streamToSession.set(streamSid, sessionId)
  logger.info('[WS MEDIA] start_ok', { connId, streamSid, sessionId })
  return { streamSid, sessionId }
}

async function handleTwilioMedia(params: {
  msg: TwilioWsEvent
  streamSid: string | null
  sessionId: string | null
  streamToSession: Map<string, string>
  stt: StartWsDeps['stt']
  logger: LoggerLike
  connId: string
}): Promise<{
  streamSid: string | null
  sessionId: string | null
  bytesPushed: number
}> {
  const { msg, streamSid, sessionId, streamToSession, stt, logger, connId } = params

  const payloadB64 = getMediaPayloadBase64(msg)
  if (!payloadB64) {
    logger.debug?.('[WS MEDIA] media_empty_payload', { connId })
    return { streamSid, sessionId, bytesPushed: 0 }
  }

  const sidFromMsg = getStreamSid(msg)
  const effectiveStreamSid = streamSid || sidFromMsg || null
  const effectiveSessionId =
    sessionId || (effectiveStreamSid ? streamToSession.get(effectiveStreamSid) ?? null : null)

  if (!effectiveStreamSid) {
    logger.warn('[WS MEDIA] media_missing_streamSid', { connId })
    return { streamSid: null, sessionId: effectiveSessionId, bytesPushed: 0 }
  }

  if (!effectiveSessionId) {
    logger.warn('[WS MEDIA] media_without_session', { connId, streamSid: effectiveStreamSid })
    return { streamSid: effectiveStreamSid, sessionId: null, bytesPushed: 0 }
  }

  try {
    const audio = Buffer.from(payloadB64, 'base64')
    await stt.pushAudio(effectiveSessionId, audio)

    logger.debug?.('[WS MEDIA] media_pushed', {
      connId,
      streamSid: effectiveStreamSid,
      sessionId: effectiveSessionId,
      bytes: audio.length,
    })

    return {
      streamSid: effectiveStreamSid,
      sessionId: effectiveSessionId,
      bytesPushed: audio.length,
    }
  } catch (err) {
    const e = asError(err)
    logger.warn('[WS MEDIA] push_audio_failed', {
      connId,
      streamSid: effectiveStreamSid,
      sessionId: effectiveSessionId,
      errorName: e.name,
      errorMessage: e.message,
    })
    return { streamSid: effectiveStreamSid, sessionId: effectiveSessionId, bytesPushed: 0 }
  }
}

async function handleTwilioStop(params: {
  msg: TwilioWsEvent
  streamSid: string | null
  sessionId: string | null
  streamToSession: Map<string, string>
  stt: StartWsDeps['stt']
  logger: LoggerLike
  connId: string
}): Promise<void> {
  const { msg, streamSid, sessionId, streamToSession, stt, logger, connId } = params

  const sid = getStreamSid(msg) || streamSid || ''
  const sess = (sid ? streamToSession.get(sid) : null) || sessionId || null

  if (sid) streamToSession.delete(sid)

  if (sess && stt.stop) {
    try {
      await stt.stop(sess)
      logger.info('[WS MEDIA] stop_stt_ok', { connId, streamSid: sid, sessionId: sess })
    } catch (err) {
      const e = asError(err)
      logger.warn('[WS MEDIA] stop_stt_failed', {
        connId,
        streamSid: sid,
        sessionId: sess,
        errorName: e.name,
        errorMessage: e.message,
      })
    }
  } else {
    logger.info('[WS MEDIA] stop_ok', { connId, streamSid: sid, sessionId: sess })
  }
}

function createGateway(sessions: StreamingSessionService, logger: LoggerLike): WsGateway {
  return {
    send(sessionId: string, type: string, payload?: any) {
      const s: any = sessions.get(sessionId)
      const ws = s?.wsPanel as WebSocket | undefined

      if (!ws) {
        logger.debug?.('[WS PANEL] send_skip_no_socket', { sessionId, type })
        return
      }

      if (ws.readyState !== WebSocket.OPEN) {
        logger.debug?.('[WS PANEL] send_skip_not_open', {
          sessionId,
          type,
          readyState: ws.readyState,
        })
        return
      }

      try {
        ws.send(JSON.stringify({ type, payload }), { compress: false, fin: true })

        logger.debug?.('[WS PANEL] send_ok', { sessionId, type })
      } catch (err) {
        logger.warn('[WS PANEL] send_failed', {
          sessionId,
          type,
          err: String(err),
        })

        closeWs(ws, 1011, 'send_failed')
      }
    },
  }
}

function registerPanelWs(params: {
  httpServer: HttpServer
  sessions: StreamingSessionService
  logger: LoggerLike
}) {
  const { httpServer, sessions, logger } = params

  type Duplex = import('node:stream').Duplex
  type NetSocket = import('node:net').Socket

  const firstHeaderValue = (v: string | string[] | undefined): string | undefined => {
    if (typeof v === 'string') return v
    if (Array.isArray(v)) return v[0]
    return undefined
  }

  const getHeader = (req: import('node:http').IncomingMessage, name: string): string | undefined =>
    firstHeaderValue(req.headers[name.toLowerCase()])

  const pickHeaders = (req: import('node:http').IncomingMessage) => ({
    host: getHeader(req, 'host') ?? null,
    upgrade: getHeader(req, 'upgrade') ?? null,
    connection: getHeader(req, 'connection') ?? null,
    origin: getHeader(req, 'origin') ?? null,
    userAgent: getHeader(req, 'user-agent') ?? null,
    xff: getHeader(req, 'x-forwarded-for') ?? null,
    cfIp: getHeader(req, 'cf-connecting-ip') ?? null,
    secWsKey: getHeader(req, 'sec-websocket-key') ?? null,
    secWsVersion: getHeader(req, 'sec-websocket-version') ?? null,
    secWsProto: getHeader(req, 'sec-websocket-protocol') ?? null,
    secWsExt: getHeader(req, 'sec-websocket-extensions') ?? null,
  })

  const getClientIp = (req: import('node:http').IncomingMessage, ws?: WebSocket): string | null => {
    const cf = getHeader(req, 'cf-connecting-ip')
    if (cf) return cf

    const xff = getHeader(req, 'x-forwarded-for')
    if (xff) return xff.split(',')[0]?.trim() ?? null

    if (req.socket.remoteAddress) return req.socket.remoteAddress

    const rawSock = ws ? ((ws as any)._socket as { remoteAddress?: string } | undefined) : undefined
    return rawSock?.remoteAddress ?? null
  }

  const writeHttpReject = (sock: Duplex, status: number, message: string) => {
    try {
      sock.write(
        `HTTP/1.1 ${status} ${message}\r\n` +
          `Connection: close\r\n` +
          `Content-Type: text/plain; charset=utf-8\r\n` +
          `Content-Length: ${Buffer.byteLength(message)}\r\n` +
          `\r\n` +
          message
      )
    } catch {}
    try {
      sock.destroy()
    } catch {}
  }

  const wssPanel = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  })

  stripWsExtensionsHeader(wssPanel, { enabled: true, logger })

  const aliveMap = new WeakMap<WebSocket, boolean>()

  const UPGRADE_GUARD = Symbol.for('ws.panel.upgrade.attached')
  if ((httpServer as any)[UPGRADE_GUARD]) {
    logger.warn('[WS PANEL] upgrade_handler_already_attached')
  } else {
    ;(httpServer as any)[UPGRADE_GUARD] = true

    httpServer.on('upgrade', (req, socket, head) => {
      const upgradeId = `pu_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
      const t0 = Date.now()
      const netSock = socket as NetSocket

      let url: URL | null = null
      try {
        const host = getHeader(req, 'host') ?? 'localhost'
        url = new URL(req.url ?? '', `http://${host}`)
      } catch {
        logger.warn('[WS PANEL] upgrade_bad_url', { upgradeId, url: req.url ?? null })
        try {
          writeHttpReject(netSock as any, 400, 'Bad Request')
        } catch {}
        return
      }

      if (url.pathname !== '/ws/panel') return

      let tcpClosedBeforeUpgrade = false
      let tcpCloseInfo: any = null

      const cleanupSockListeners = () => {
        try {
          netSock.removeListener('close', onSockClose)
          netSock.removeListener('end', onSockEnd)
          netSock.removeListener('error', onSockError as any)
          netSock.removeListener('timeout', onSockTimeout)
        } catch {}
      }

      const onSockClose = (hadError: boolean) => {
        tcpClosedBeforeUpgrade = true
        tcpCloseInfo = { hadError, sock: sockMeta(netSock as any) }
        logger.warn('[WS PANEL] upgrade_tcp_close', {
          upgradeId,
          hadError,
          dtMs: Date.now() - t0,
          sock: sockMeta(netSock as any),
        })
      }

      const onSockEnd = () => {
        logger.warn('[WS PANEL] upgrade_tcp_end', { upgradeId, dtMs: Date.now() - t0 })
      }

      const onSockError = (err: unknown) => {
        logger.warn('[WS PANEL] upgrade_tcp_error', {
          upgradeId,
          dtMs: Date.now() - t0,
          sock: sockMeta(netSock as any),
          ...errMeta(err),
        })
      }

      const onSockTimeout = () => {
        logger.warn('[WS PANEL] upgrade_tcp_timeout', { upgradeId, dtMs: Date.now() - t0 })
        try {
          netSock.destroy()
        } catch {}
      }

      netSock.once('close', onSockClose)
      netSock.once('end', onSockEnd)
      netSock.once('error', onSockError as any)
      netSock.once('timeout', onSockTimeout)

      try {
        netSock.setTimeout(30_000)
      } catch {}

      try {
        const sessionIdOrNull = url.searchParams.get('sessionId') || null
        const sid = sessionIdOrNull ?? ''
        const ip = getClientIp(req)
        const h = pickHeaders(req)

        logger.info('[WS PANEL] upgrade_received', {
          upgradeId,
          url: req.url ?? null,
          method: (req as any).method ?? null,
          sessionId: sessionIdOrNull,
          ip,
          headers: h,
          sock: sockMeta(netSock as any),
        })

        if (h.secWsExt) {
          logger.info('[WS PANEL] stripping_client_extensions', {
            upgradeId,
            sessionId: sessionIdOrNull,
            secWsExt: h.secWsExt,
          })
          try {
            delete (req.headers as any)['sec-websocket-extensions']
          } catch {}
        }

        const method = ((req as any).method as string | undefined) ?? 'GET'
        if (method !== 'GET') {
          logger.warn('[WS PANEL] upgrade_reject_method', {
            upgradeId,
            method,
            sessionId: sessionIdOrNull,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          writeHttpReject(netSock as any, 405, 'Method Not Allowed')
          return
        }

        const upgradeHdr = (h.upgrade ?? '').toLowerCase()
        if (upgradeHdr !== 'websocket') {
          logger.warn('[WS PANEL] upgrade_reject_not_websocket', {
            upgradeId,
            upgrade: h.upgrade,
            sessionId: sessionIdOrNull,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          writeHttpReject(netSock as any, 426, 'Upgrade Required')
          return
        }

        const version = h.secWsVersion ?? ''
        if (version && version !== '13') {
          logger.warn('[WS PANEL] upgrade_reject_bad_version', {
            upgradeId,
            version,
            sessionId: sessionIdOrNull,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          writeHttpReject(netSock as any, 400, 'Bad WebSocket Version')
          return
        }

        if (!sid) {
          logger.warn('[WS PANEL] upgrade_reject_missing_sessionId', {
            upgradeId,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          writeHttpReject(netSock as any, 400, 'Missing sessionId')
          return
        }

        if (!sessions.get(sid)) {
          logger.warn('[WS PANEL] upgrade_reject_invalid_session', {
            upgradeId,
            sessionId: sid,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          writeHttpReject(netSock as any, 404, 'Invalid sessionId')
          return
        }

        if (tcpClosedBeforeUpgrade) {
          logger.warn('[WS PANEL] upgrade_aborted_socket_closed', {
            upgradeId,
            sessionId: sid,
            tcpCloseInfo,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          try {
            netSock.destroy()
          } catch {}
          return
        }

        logger.info('[WS PANEL] upgrade_accepting', {
          upgradeId,
          sessionId: sid,
          dtMs: Date.now() - t0,
          sock: sockMeta(netSock as any),
        })

        wssPanel.handleUpgrade(req, netSock, head, (ws) => {
          cleanupSockListeners()

          logger.info('[WS PANEL] upgrade_success', {
            upgradeId,
            sessionId: sid,
            dtMs: Date.now() - t0,
            negotiatedProtocol: (ws as any).protocol ?? null,
            negotiatedExtensions: (ws as any).extensions ?? null,
            readyState: ws.readyState,
          })

          wssPanel.emit('connection', ws, req)
        })
      } catch (err) {
        logger.warn('[WS PANEL] upgrade_handler_failed', {
          upgradeId,
          dtMs: Date.now() - t0,
          err: String(err),
        })
        cleanupSockListeners()
        try {
          writeHttpReject(netSock as any, 500, 'Internal Server Error')
        } catch {}
      }
    })
  }

  wssPanel.on('connection', (ws, req) => {
    const connId = `panel_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
    const startedAt = Date.now()

    let sessionId: string | null = null
    let closing = false
    let hb: NodeJS.Timeout | null = null

    const rawSock = ((ws as any)._socket as import('node:net').Socket | undefined) ?? undefined

    const _send = ws.send.bind(ws)
    ws.send = ((data: any, options?: any, cb?: any) => {
      if (typeof options === 'function') return _send(data, { compress: false, fin: true }, options)
      return _send(data, { ...(options ?? {}), compress: false, fin: true }, cb)
    }) as any

    const closeOnce = (code: number, reason: string) => {
      if (closing) return
      closing = true
      closeWs(ws, code, reason)
    }

    const sendPanel = (obj: any) => {
      if (ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify(obj), { compress: false, fin: true })
      } catch (err) {
        logger.warn('[WS PANEL] send_failed', { connId, sessionId, err: String(err) })
        closeOnce(1011, 'send_failed')
      }
    }

    const stopHeartbeat = () => {
      if (hb) {
        clearInterval(hb)
        hb = null
      }
    }

    if (rawSock) {
      rawSock.on('close', (hadError: boolean) => {
        logger.warn('[WS PANEL] tcp_close', {
          connId,
          sessionId,
          hadError,
          sock: sockMeta(rawSock),
        })
      })
      rawSock.on('end', () => {
        logger.warn('[WS PANEL] tcp_end', { connId, sessionId, sock: sockMeta(rawSock) })
      })
      rawSock.on('timeout', () => {
        logger.warn('[WS PANEL] tcp_timeout', { connId, sessionId, sock: sockMeta(rawSock) })
      })
      rawSock.on('error', (err: unknown) => {
        logger.warn('[WS PANEL] tcp_error', {
          connId,
          sessionId,
          sock: sockMeta(rawSock),
          ...errMeta(err),
        })
      })
    }

    try {
      const host = getHeader(req, 'host') ?? 'localhost'
      const rawUrl = req.url ?? ''
      const url = new URL(rawUrl, `http://${host}`)

      sessionId = url.searchParams.get('sessionId') || null
      const sid = sessionId ?? ''

      const ip = getClientIp(req, ws)
      const h = pickHeaders(req)

      logger.info('[WS PANEL] connection', {
        connId,
        sessionId,
        ip,
        url: rawUrl,
        path: url.pathname,
        headers: h,
        negotiatedProtocol: (ws as any).protocol ?? null,
        negotiatedExtensions: (ws as any).extensions ?? null,
        wsReadyState: ws.readyState,
      })

      if (!sid) {
        logger.warn('[WS PANEL] reject_missing_sessionId', { connId, ip, url: rawUrl })
        closeOnce(1008, 'Missing sessionId')
        return
      }

      if (url.pathname !== '/ws/panel') {
        logger.warn('[WS PANEL] reject_bad_path', {
          connId,
          sessionId,
          path: url.pathname,
          url: rawUrl,
        })
        closeOnce(1008, 'Bad path')
        return
      }

      const s = sessions.setPanelSocket(sid, ws as any)
      if (!s) {
        logger.warn('[WS PANEL] invalid_session_on_connection', { connId, sessionId })
        closeOnce(1008, 'Invalid sessionId')
        return
      }

      ;(s as any).panelSeq = ((s as any).panelSeq ?? 0) + 1
      logger.info('[WS PANEL] sending', {
        connId,
        sessionId,
        seq: (s as any).panelSeq,
        type: 'SESSION_STARTED',
      })

      sendPanel({
        type: 'SESSION_STARTED',
        payload: { sessionId: sid, callId: s.callId },
      })

      logger.info('[WS PANEL] session_attached', { connId, sessionId, callId: s.callId })

      aliveMap.set(ws, true)
      ws.on('pong', () => aliveMap.set(ws, true))

      hb = setInterval(() => {
        if (ws.readyState !== WebSocket.OPEN) return

        const alive = aliveMap.get(ws) ?? false
        if (!alive) {
          logger.warn('[WS PANEL] heartbeat_dead', {
            connId,
            sessionId,
            aliveMs: Date.now() - startedAt,
          })
          closeOnce(1001, 'heartbeat_timeout')
          return
        }

        aliveMap.set(ws, false)
        try {
          ws.ping()
        } catch (err) {
          logger.warn('[WS PANEL] ping_failed', { connId, sessionId, err: String(err) })
          closeOnce(1011, 'ping_failed')
        }
      }, 25_000)

      ws.on('error', (err) => {
        const e = err instanceof Error ? err : new Error(String(err))
        logger.warn('[WS PANEL] socket_error', {
          connId,
          sessionId,
          errorName: e.name,
          errorMessage: e.message,
        })
        closeOnce(1011, 'socket_error')
      })

      ws.on('close', (code, reason) => {
        stopHeartbeat()
        const r = bufToDebug(reason as any)
        logger.info('[WS PANEL] disconnected', {
          connId,
          sessionId,
          code,
          ...r,
          aliveMs: Date.now() - startedAt,
          wsReadyState: ws.readyState,
          sock: sockMeta(rawSock),
          negotiatedProtocol: (ws as any).protocol ?? null,
          negotiatedExtensions: (ws as any).extensions ?? null,
        })
      })

      req.on('aborted', () => {
        logger.warn('[WS PANEL] req_aborted', {
          connId,
          sessionId,
          aliveMs: Date.now() - startedAt,
        })
        closeOnce(1011, 'req_aborted')
      })
    } catch (err) {
      stopHeartbeat()
      const e = err instanceof Error ? err : new Error(String(err))
      logger.error('[WS PANEL] connection_handler_failed', {
        connId,
        errorName: e.name,
        errorMessage: e.message,
        errorStack: e.stack,
      })
      closeOnce(1011, 'Internal error')
    }
  })
}

function registerMediaWs(params: {
  httpServer: HttpServer
  sessions: StreamingSessionService
  stt: StartWsDeps['stt']
  logger: LoggerLike
}) {
  const { httpServer, sessions, stt, logger } = params

  const wssMedia = new WebSocketServer({
    noServer: true,
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  })

  stripWsExtensionsHeader(wssMedia, { enabled: true, logger })

  const streamToSession = new Map<string, string>()

  const aliveMap = new WeakMap<WebSocket, boolean>()

  const UPGRADE_GUARD = Symbol.for('ws.media.upgrade.attached')
  if ((httpServer as any)[UPGRADE_GUARD]) {
    logger.warn('[WS MEDIA] upgrade_handler_already_attached')
  } else {
    ;(httpServer as any)[UPGRADE_GUARD] = true

    type Duplex = import('node:stream').Duplex
    type NetSocket = import('node:net').Socket

    const firstHeaderValue = (v: string | string[] | undefined): string | undefined => {
      if (typeof v === 'string') return v
      if (Array.isArray(v)) return v[0]
      return undefined
    }

    const getHeader = (
      req: import('node:http').IncomingMessage,
      name: string
    ): string | undefined => firstHeaderValue(req.headers[name.toLowerCase()])

    const writeHttpReject = (sock: Duplex, status: number, message: string) => {
      try {
        sock.write(
          `HTTP/1.1 ${status} ${message}\r\n` +
            `Connection: close\r\n` +
            `Content-Type: text/plain; charset=utf-8\r\n` +
            `Content-Length: ${Buffer.byteLength(message)}\r\n` +
            `\r\n` +
            message
        )
      } catch {}
      try {
        sock.destroy()
      } catch {}
    }

    httpServer.on('upgrade', (req, socket, head) => {
      const upgradeId = `mu_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
      const t0 = Date.now()

      const netSock = socket as NetSocket

      try {
        const host = getHeader(req, 'host') ?? 'localhost'
        const url = new URL(req.url ?? '', `http://${host}`)

        if (url.pathname !== '/ws/media') {
          return
        }

        const method = ((req as any).method as string | undefined) ?? 'GET'
        if (method !== 'GET') {
          logger.warn('[WS MEDIA] upgrade_reject_method', {
            upgradeId,
            method,
            dtMs: Date.now() - t0,
          })
          writeHttpReject(netSock as any, 405, 'Method Not Allowed')
          return
        }

        const upgradeHdr = (getHeader(req, 'upgrade') ?? '').toLowerCase()
        if (upgradeHdr !== 'websocket') {
          logger.warn('[WS MEDIA] upgrade_reject_not_websocket', {
            upgradeId,
            upgrade: getHeader(req, 'upgrade') ?? null,
            dtMs: Date.now() - t0,
          })
          writeHttpReject(netSock as any, 426, 'Upgrade Required')
          return
        }

        const version = getHeader(req, 'sec-websocket-version') ?? ''
        if (version && version !== '13') {
          logger.warn('[WS MEDIA] upgrade_reject_bad_version', {
            upgradeId,
            version,
            dtMs: Date.now() - t0,
          })
          writeHttpReject(netSock as any, 400, 'Bad WebSocket Version')
          return
        }

        logger.info('[WS MEDIA] upgrade_accepting', {
          upgradeId,
          url: req.url ?? null,
          dtMs: Date.now() - t0,
        })

        wssMedia.handleUpgrade(req, netSock, head, (ws) => {
          logger.info('[WS MEDIA] upgrade_success', {
            upgradeId,
            dtMs: Date.now() - t0,
            negotiatedExtensions: (ws as any).extensions ?? null,
            negotiatedProtocol: (ws as any).protocol ?? null,
          })
          wssMedia.emit('connection', ws, req)
        })
      } catch (err) {
        logger.warn('[WS MEDIA] upgrade_handler_failed', {
          upgradeId,
          dtMs: Date.now() - t0,
          err: String(err),
        })
        try {
          writeHttpReject(netSock as any, 500, 'Internal Server Error')
        } catch {}
      }
    })
  }

  wssMedia.on('connection', (ws, req) => {
    const connId = `media_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
    const startedAt = Date.now()

    let streamSid: string | null = null
    let sessionId: string | null = null
    let closing = false
    let stopCalled = false

    const closeOnce = (code: number, reason: string) => {
      if (closing) return
      closing = true
      closeWs(ws, code, reason)
    }

    const stopSttOnce = async (why: string) => {
      if (stopCalled) return
      stopCalled = true
      if (!sessionId || !stt.stop) return

      try {
        await stt.stop(sessionId)
        logger.info('[WS MEDIA] stt_stop_ok', { connId, sessionId, why })
      } catch (err) {
        const e = asError(err)
        logger.warn('[WS MEDIA] stt_stop_failed', {
          connId,
          sessionId,
          why,
          errorName: e.name,
          errorMessage: e.message,
        })
      }
    }

    const rawSock = ((ws as any)._socket as import('node:net').Socket | undefined) ?? undefined

    ws.on('close', (code, reason) => {
      logger.warn('[WS MEDIA] close_event', {
        connId,
        sessionId,
        code,
        reason: Buffer.isBuffer(reason) ? reason.toString('utf8') : String(reason ?? ''),
        sock: sockMeta(rawSock),
      })
    })

    if (rawSock) {
      rawSock.on('close', (hadError: boolean) => {
        logger.warn('[WS MEDIA] tcp_close', {
          connId,
          streamSid,
          sessionId,
          hadError,
          sock: sockMeta(rawSock),
        })
      })
      rawSock.on('end', () => {
        logger.warn('[WS MEDIA] tcp_end', { connId, streamSid, sessionId, sock: sockMeta(rawSock) })
      })
      rawSock.on('timeout', () => {
        logger.warn('[WS MEDIA] tcp_timeout', {
          connId,
          streamSid,
          sessionId,
          sock: sockMeta(rawSock),
        })
      })
      rawSock.on('error', (err: unknown) => {
        logger.warn('[WS MEDIA] tcp_error', {
          connId,
          streamSid,
          sessionId,
          sock: sockMeta(rawSock),
          ...errMeta(err),
        })
      })
    }

    const ip =
      (req.headers['x-forwarded-for'] as string | undefined) ?? req.socket.remoteAddress ?? null
    const ua = (req.headers['user-agent'] as string | undefined) ?? null

    logger.info('[WS MEDIA] connection', { connId, ip, ua })

    aliveMap.set(ws, true)
    ws.on('pong', () => aliveMap.set(ws, true))

    const hb = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return

      const alive = aliveMap.get(ws) ?? false
      if (!alive) {
        logger.warn('[WS MEDIA] heartbeat_dead', { connId, streamSid, sessionId })
        closeOnce(1001, 'heartbeat_timeout')
        return
      }

      aliveMap.set(ws, false)
      try {
        ws.ping()
      } catch (err) {
        logger.warn('[WS MEDIA] heartbeat_failed', { connId, err: String(err) })
        closeOnce(1011, 'heartbeat_failed')
      }
    }, 15_000)

    const cleanup = async (why: string) => {
      clearInterval(hb)
      if (streamSid) streamToSession.delete(streamSid)
      await stopSttOnce(why)
    }

    ws.on('message', async (raw) => {
      const msg = safeJsonParse(raw, logger)
      if (!msg) return

      const event = String(msg.event ?? '')
      logger.debug?.('[WS MEDIA] rx_event', { connId, event })

      try {
        if (isStartEvent(msg)) {
          const startRes = await handleTwilioStart({
            msg,
            ws,
            sessions,
            streamToSession,
            logger,
            connId,
          })
          if (!startRes) return

          streamSid = startRes.streamSid
          sessionId = startRes.sessionId
          streamToSession.set(streamSid, sessionId)

          aliveMap.set(ws, true)
          return
        }

        if (isMediaEvent(msg)) {
          const res = await handleTwilioMedia({
            msg,
            streamSid,
            sessionId,
            streamToSession,
            stt,
            logger,
            connId,
          })

          streamSid = res.streamSid
          sessionId = res.sessionId

          aliveMap.set(ws, true)
          return
        }

        if (isStopEvent(msg)) {
          await handleTwilioStop({
            msg,
            streamSid,
            sessionId,
            streamToSession,
            stt,
            logger,
            connId,
          })

          await stopSttOnce('twilio_stop_event')
          closeOnce(1000, 'stop')
          return
        }

        logger.warn('[WS MEDIA] unknown_event', { connId, event })
      } catch (err) {
        logger.warn('[WS MEDIA] message_handler_failed', {
          connId,
          streamSid,
          sessionId,
          err: String(err),
        })
        closeOnce(1011, 'handler_failed')
      }
    })

    ws.on('close', async (code, reason) => {
      const r = bufToDebug(reason as any)

      logger.info('[WS MEDIA] disconnected', {
        connId,
        streamSid,
        sessionId,
        code,
        ...r,
        aliveMs: Date.now() - startedAt,
        sock: sockMeta(rawSock),
      })

      await cleanup(`ws_close_${code}`)
    })

    ws.on('error', (err) => {
      const e = asError(err)
      logger.warn('[WS MEDIA] socket_error', {
        connId,
        streamSid,
        sessionId,
        errorName: e.name,
        errorMessage: e.message,
      })
      closeOnce(1011, 'socket_error')
    })

    req.on('aborted', () => {
      logger.warn('[WS MEDIA] req_aborted', { connId, streamSid, sessionId })
      closeOnce(1006, 'req_aborted')
    })
  })
}

export function startWebSocketServer(httpServer: HttpServer, deps: StartWsDeps): WsGateway {
  registerPanelWs({ httpServer, sessions: deps.sessions, logger: deps.logger })
  registerMediaWs({ httpServer, sessions: deps.sessions, stt: deps.stt, logger: deps.logger })
  deps.logger.info('[WS] started', { endpoints: ['/ws/panel', '/ws/media'] })
  deps.logger.info('[HTTP] upgrade listeners', { count: httpServer.listeners('upgrade').length })
  console.log(httpServer.listeners('upgrade').map((fn) => fn.name || 'anonymous'))
  return createGateway(deps.sessions, deps.logger)
}
