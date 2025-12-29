import type { Server as HttpServer } from 'node:http'
import type net from 'node:net'
import { Transform } from 'node:stream'
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

//Tipo base con props opcionales (evita TS2339) + sin union con string (evita S6571)
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
  // Twilio manda más campos; permitimos extras:
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
    reasonStr: b.toString('utf8'), // puede verse raro si no es utf8 -> por eso también hex
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

/**
 * Limpia el bit RSV1 (compresión) de los frames WebSocket entrantes.
 * Esto previene el error "RSV1 must be clear" cuando ngrok o el cliente
 * envía frames comprimidos aunque el servidor no acepte compresión.
 * 
 * Intercepta los datos usando un Transform stream que limpia el bit RSV1
 * antes de que lleguen a ws.
 */
function createRsv1CleanerSocket(socket: net.Socket, logger: LoggerLike): net.Socket {
  // Interceptar el método _readableState.push para limpiar RSV1
  const readableState = (socket as any)._readableState
  if (readableState) {
    const originalPush = readableState.buffer?.push || 
      ((chunk: any) => readableState.buffer?.push(chunk))
    
    // Interceptar push en el buffer interno
    if (readableState.buffer) {
      const originalBufferPush = readableState.buffer.push
      readableState.buffer.push = function (chunk: any) {
        if (Buffer.isBuffer(chunk) && chunk.length > 0) {
          const firstByte = chunk[0]
          if (firstByte & 0x40) {
            const cleaned = Buffer.from(chunk)
            cleaned[0] = firstByte & 0xbf
            logger.debug?.('[WS] cleaned_rsv1_bit', {
              original: firstByte.toString(16),
              cleaned: cleaned[0].toString(16),
            })
            return originalBufferPush.call(this, cleaned)
          }
        }
        return originalBufferPush.call(this, chunk)
      }
    }
  }
  
  // Interceptar el método push del socket directamente
  const originalPush = (socket as any).push
  if (originalPush) {
    (socket as any).push = function (chunk: any, encoding?: any) {
      if (Buffer.isBuffer(chunk) && chunk.length > 0) {
        const firstByte = chunk[0]
        if (firstByte & 0x40) {
          const cleaned = Buffer.from(chunk)
          cleaned[0] = firstByte & 0xbf
          logger.debug?.('[WS] cleaned_rsv1_bit_via_push', {
            original: firstByte.toString(16),
            cleaned: cleaned[0].toString(16),
          })
          return originalPush.call(this, cleaned, encoding)
        }
      }
      return originalPush.call(this, chunk, encoding)
    }
  }
  
  // Interceptar emit('data') como último recurso
  const originalEmit = socket.emit.bind(socket)
  socket.emit = function (event: string, ...args: any[]) {
    if (event === 'data' && args[0] instanceof Buffer && args[0].length > 0) {
      const chunk = args[0]
      const firstByte = chunk[0]
      if (firstByte & 0x40) {
        const cleaned = Buffer.from(chunk)
        cleaned[0] = firstByte & 0xbf
        logger.debug?.('[WS] cleaned_rsv1_bit_via_emit', {
          original: firstByte.toString(16),
          cleaned: cleaned[0].toString(16),
        })
        return originalEmit.call(this, event, cleaned, ...args.slice(1))
      }
    }
    return originalEmit.call(this, event, ...args)
  }
  
  return socket
}

export function stripWsExtensionsHeader(wss: WebSocketServer) {
  const k = Symbol.for('ws.stripWsExtensionsHeader.attached')
  const anyWss = wss as any
  if (anyWss[k]) return
  anyWss[k] = true

  wss.on('headers', (headers) => {
    if (!Array.isArray(headers) || headers.length === 0) return

    for (let i = headers.length - 1; i >= 0; i--) {
      const h = headers[i]
      if (typeof h !== 'string') continue
      if (/^\s*sec-websocket-extensions\s*:/i.test(h)) {
        headers.splice(i, 1)
      }
    }
  })
}

function closeWs(ws: WebSocket, code: number, reason: string) {
  try {
    ws.close(code, reason)
  } catch {}
  setTimeout(() => {
    try {
      ws.terminate()
    } catch {}
  }, 500)
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

//type guards por event
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

  // resolver streamSid/sessionId si no llegaron aún
  const sidFromMsg = getStreamSid(msg)
  const effectiveStreamSid = streamSid || sidFromMsg || null
  const effectiveSessionId =
    sessionId || (effectiveStreamSid ? streamToSession.get(effectiveStreamSid) ?? null : null)

  if (!effectiveStreamSid) {
    logger.warn('[WS MEDIA] media_missing_streamSid', { connId })
    return { streamSid: null, sessionId: effectiveSessionId, bytesPushed: 0 }
  }

  if (!effectiveSessionId) {
    // Normal si llega media antes que start (o si se perdió start)
    logger.warn('[WS MEDIA] media_without_session', { connId, streamSid: effectiveStreamSid })
    return { streamSid: effectiveStreamSid, sessionId: null, bytesPushed: 0 }
  }

  try {
    // Twilio manda mulaw 8k en base64 -> se envía tal cual a STT con encoding=mulaw
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

  //Tipos para arreglar TS2339/TS2345 del upgrade socket
  // Node tipa "socket" del evento upgrade como Duplex, pero en runtime es net.Socket.
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

  //Acepta Duplex (tipo del upgrade) o Socket (net.Socket)
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
    // Habilitar perMessageDeflate para aceptar frames comprimidos de ngrok,
    // pero configurado para no comprimir nuestros mensajes de salida
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      zlibInflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      serverMaxWindowBits: 10,
      concurrencyLimit: 10,
      threshold: 1024, // Solo comprimir mensajes > 1KB (nuestros mensajes son pequeños)
    },
    maxPayload: 1024 * 1024,
  })

  // Ya no necesitamos eliminar el header de extensiones porque ahora aceptamos compresión
  // stripWsExtensionsHeader(wssPanel)

  const aliveMap = new WeakMap<WebSocket, boolean>()

  // ---------------------------
  // UPGRADE HANDLER (diagnóstico)
  // ---------------------------
  //RECOMENDADO: evita registrar el upgrade handler más de una vez (hot-reload / doble start)
  const UPGRADE_GUARD = Symbol.for('ws.panel.upgrade.attached')
  if ((httpServer as any)[UPGRADE_GUARD]) {
    logger.warn('[WS PANEL] upgrade_handler_already_attached')
  } else {
    ;(httpServer as any)[UPGRADE_GUARD] = true

    httpServer.on('upgrade', (req, socket, head) => {
      const upgradeId = `up_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
      const t0 = Date.now()

      const netSock = socket as NetSocket

      let tcpClosedBeforeUpgrade = false
      let tcpCloseInfo: any = null

      // 🔧 helper: remove listeners SIEMPRE (también en pass-through)
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
        const host = getHeader(req, 'host') ?? 'localhost'
        const url = new URL(req.url ?? '', `http://${host}`)

        if (url.pathname !== '/ws/panel') {
          logger.debug?.('[WS PANEL] upgrade_pass_through', {
            upgradeId,
            path: url.pathname,
            url: req.url ?? null,
            dtMs: Date.now() - t0,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          return
        }

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

        // Ya no eliminamos el header de extensiones porque ahora aceptamos compresión
        // para evitar el error RSV1 cuando ngrok comprime los frames
        // if (h.secWsExt) {
        //   logger.info('[WS PANEL] stripping_client_extensions', {
        //     upgradeId,
        //     sessionId: sessionIdOrNull,
        //     secWsExt: h.secWsExt,
        //   })
        //   try {
        //     delete (req.headers as any)['sec-websocket-extensions']
        //   } catch {}
        // }

        // Validaciones típicas
        const method = ((req as any).method as string | undefined) ?? 'GET'
        if (method !== 'GET') {
          logger.warn('[WS PANEL] upgrade_reject_method', {
            upgradeId,
            method,
            sessionId: sessionIdOrNull,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          writeHttpReject(netSock, 405, 'Method Not Allowed')
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
          writeHttpReject(netSock, 426, 'Upgrade Required')
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
          writeHttpReject(netSock, 400, 'Bad WebSocket Version')
          return
        }

        if (!sid) {
          logger.warn('[WS PANEL] upgrade_reject_missing_sessionId', {
            upgradeId,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          writeHttpReject(netSock, 400, 'Missing sessionId')
          return
        }

        if (!sessions.get(sid)) {
          logger.warn('[WS PANEL] upgrade_reject_invalid_session', {
            upgradeId,
            sessionId: sid,
            sock: sockMeta(netSock as any),
          })
          cleanupSockListeners()
          writeHttpReject(netSock, 404, 'Invalid sessionId')
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

        // CRÍTICO: Limpiar bit RSV1 de los frames entrantes ANTES de pasarlo a ws
        // Usar un proxy completo del socket que intercepte TODOS los métodos de lectura
        const cleanRsv1 = (chunk: Buffer): Buffer => {
          if (!Buffer.isBuffer(chunk) || chunk.length === 0) return chunk
          const firstByte = chunk[0]
          if (firstByte & 0x40) {
            const cleaned = Buffer.from(chunk)
            cleaned[0] = firstByte & 0xbf
            logger.debug?.('[WS PANEL] cleaned_rsv1_bit', {
              upgradeId,
              original: firstByte.toString(16),
              cleaned: cleaned[0].toString(16),
              length: chunk.length,
            })
            return cleaned
          }
          return chunk
        }
        
        // Interceptar el método push del stream (más efectivo - se ejecuta antes de que ws lea)
        if (typeof (netSock as any).push === 'function') {
          const originalPush = (netSock as any).push.bind(netSock)
          ;(netSock as any).push = function (chunk: any, encoding?: any) {
            if (Buffer.isBuffer(chunk)) {
              const cleaned = cleanRsv1(chunk)
              return originalPush(cleaned, encoding)
            }
            return originalPush(chunk, encoding)
          }
        }
        
        // Interceptar el readableState.buffer directamente (más bajo nivel)
        const readableState = (netSock as any)._readableState
        if (readableState && readableState.buffer) {
          const buffer = readableState.buffer
          if (Array.isArray(buffer)) {
            // Interceptar push en el buffer array
            const originalBufferPush = buffer.push.bind(buffer)
            buffer.push = function (chunk: any) {
              if (Buffer.isBuffer(chunk)) {
                return originalBufferPush(cleanRsv1(chunk))
              }
              return originalBufferPush(chunk)
            }
          }
        }
        
        // Interceptar emit('data') como respaldo crítico (se ejecuta cuando se emiten datos)
        const originalEmit = netSock.emit.bind(netSock)
        netSock.emit = function (event: string, ...args: any[]) {
          if (event === 'data' && args[0] instanceof Buffer) {
            const cleaned = cleanRsv1(args[0])
            return originalEmit.call(this, event, cleaned, ...args.slice(1))
          }
          return originalEmit.call(this, event, ...args)
        }
        
        // Interceptar on('data') para limpiar antes de que llegue a los listeners
        const originalOn = netSock.on.bind(netSock)
        netSock.on = function (event: string, listener: any) {
          if (event === 'data') {
            const wrappedListener = (chunk: Buffer) => {
              listener(cleanRsv1(chunk))
            }
            return originalOn.call(this, event, wrappedListener)
          }
          return originalOn.call(this, event, listener)
        }
        
        // Interceptar once('data') también
        const originalOnce = netSock.once.bind(netSock)
        netSock.once = function (event: string, listener: any) {
          if (event === 'data') {
            const wrappedListener = (chunk: Buffer) => {
              listener(cleanRsv1(chunk))
            }
            return originalOnce.call(this, event, wrappedListener)
          }
          return originalOnce.call(this, event, listener)
        }

        wssPanel.handleUpgrade(req, netSock, head, (ws) => {
          cleanupSockListeners()

          const negotiatedExtensions = (ws as any).extensions ?? null
          
          logger.info('[WS PANEL] upgrade_success', {
            upgradeId,
            sessionId: sid,
            dtMs: Date.now() - t0,
            negotiatedProtocol: (ws as any).protocol ?? null,
            negotiatedExtensions,
            readyState: ws.readyState,
          })

          // CRÍTICO: Interceptar el método interno de ws que procesa los frames
          // para limpiar el bit RSV1 antes de que ws valide el frame
          try {
            const receiver = (ws as any)._receiver
            if (receiver) {
              // Interceptar receiver.add (método principal que procesa frames)
              if (typeof receiver.add === 'function') {
                const originalAdd = receiver.add.bind(receiver)
                receiver.add = function (data: Buffer) {
                  try {
                    if (Buffer.isBuffer(data) && data.length > 0) {
                      const firstByte = data[0]
                      if (firstByte & 0x40) {
                        const cleaned = Buffer.from(data)
                        cleaned[0] = firstByte & 0xbf
                        logger.debug?.('[WS PANEL] cleaned_rsv1_in_receiver', {
                          upgradeId,
                          sessionId: sid,
                          original: firstByte.toString(16),
                          cleaned: cleaned[0].toString(16),
                        })
                        return originalAdd(cleaned)
                      }
                    }
                    return originalAdd(data)
                  } catch (err) {
                    logger.warn('[WS PANEL] receiver_add_interceptor_error', {
                      upgradeId,
                      sessionId: sid,
                      err: String(err),
                    })
                    return originalAdd(data)
                  }
                }
              }
              
              // Interceptar receiver.write si existe (puede procesar frames antes de add)
              if (typeof receiver.write === 'function') {
                const originalWrite = receiver.write.bind(receiver)
                receiver.write = function (data: Buffer) {
                  try {
                    if (Buffer.isBuffer(data) && data.length > 0) {
                      const firstByte = data[0]
                      if (firstByte & 0x40) {
                        const cleaned = Buffer.from(data)
                        cleaned[0] = firstByte & 0xbf
                        logger.debug?.('[WS PANEL] cleaned_rsv1_in_receiver_write', {
                          upgradeId,
                          sessionId: sid,
                          original: firstByte.toString(16),
                          cleaned: cleaned[0].toString(16),
                        })
                        return originalWrite(cleaned)
                      }
                    }
                    return originalWrite(data)
                  } catch (err) {
                    return originalWrite(data)
                  }
                }
              }
              
              // Interceptar receiver._write si existe (método interno de stream)
              if (typeof receiver._write === 'function') {
                const originalWrite = receiver._write.bind(receiver)
                receiver._write = function (chunk: Buffer, encoding: string, callback: Function) {
                  try {
                    if (Buffer.isBuffer(chunk) && chunk.length > 0) {
                      const firstByte = chunk[0]
                      if (firstByte & 0x40) {
                        const cleaned = Buffer.from(chunk)
                        cleaned[0] = firstByte & 0xbf
                        logger.debug?.('[WS PANEL] cleaned_rsv1_in_receiver_write_internal', {
                          upgradeId,
                          sessionId: sid,
                          original: firstByte.toString(16),
                          cleaned: cleaned[0].toString(16),
                        })
                        return originalWrite(cleaned, encoding, callback)
                      }
                    }
                    return originalWrite(chunk, encoding, callback)
                  } catch (err) {
                    return originalWrite(chunk, encoding, callback)
                  }
                }
              }
            }
          } catch (err) {
            logger.warn('[WS PANEL] receiver_interceptor_setup_error', {
              upgradeId,
              sessionId: sid,
              err: String(err),
            })
          }

          // Ya no rechazamos extensiones porque ahora aceptamos compresión para ngrok
          // if (negotiatedExtensions) {
          //   logger.warn('[WS PANEL] upgrade_reject_extensions_negotiated', {
          //     upgradeId,
          //     sessionId: sid,
          //     negotiatedExtensions,
          //   })
          //   try {
          //     ws.close(1008, 'Extensions not supported')
          //   } catch {}
          //   try {
          //     ws.terminate()
          //   } catch {}
          //   return
          // }

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
          writeHttpReject(netSock, 500, 'Internal Server Error')
        } catch {}
      }
    })
  }

  // ---------------------------
  // CONNECTION HANDLER (diagnóstico)
  // ---------------------------
  wssPanel.on('connection', (ws, req) => {
    const connId = `panel_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`
    const startedAt = Date.now()

    let sessionId: string | null = null
    let closing = false
    let hb: NodeJS.Timeout | null = null

    const rawSock = ((ws as any)._socket as import('node:net').Socket | undefined) ?? undefined

    // CRÍTICO: Interceptar el receiver de ws para limpiar RSV1 antes de que procese los frames
    try {
      const receiver = (ws as any)._receiver
      if (receiver && typeof receiver.add === 'function') {
        const originalAdd = receiver.add.bind(receiver)
        receiver.add = function (data: Buffer) {
          try {
            if (Buffer.isBuffer(data) && data.length > 0) {
              const firstByte = data[0]
              if (firstByte & 0x40) {
                const cleaned = Buffer.from(data)
                cleaned[0] = firstByte & 0xbf
                logger.debug?.('[WS PANEL] cleaned_rsv1_in_receiver_connection', {
                  connId,
                  original: firstByte.toString(16),
                  cleaned: cleaned[0].toString(16),
                })
                return originalAdd(cleaned)
              }
            }
            return originalAdd(data)
          } catch (err) {
            logger.warn('[WS PANEL] receiver_add_interceptor_error_connection', {
              connId,
              err: String(err),
            })
            return originalAdd(data)
          }
        }
      }
    } catch (err) {
      logger.warn('[WS PANEL] receiver_interceptor_setup_error_connection', {
        connId,
        err: String(err),
      })
    }

    const closeOnce = (code: number, reason: string) => {
      if (closing) return
      closing = true
      closeWs(ws, code, reason)
    }

    //Envío blindado: NUNCA compresión (evita RSV1)
    const sendPanel = (obj: any) => {
      if (ws.readyState !== WebSocket.OPEN) return
      try {
        ws.send(JSON.stringify(obj), { compress: false, fin: true })
      } catch (err) {
        logger.warn('[WS PANEL] send_failed', {
          connId,
          sessionId,
          err: String(err),
        })
        closeOnce(1011, 'send_failed')
      }
    }

    //Limpieza centralizada
    const stopHeartbeat = () => {
      if (hb) {
        clearInterval(hb)
        hb = null
      }
    }

    // ---- TCP diagnostics (raw socket) ----
    if (rawSock) {
      // Interceptar datos para limpiar bit RSV1 (compresión) de frames WebSocket
      // Esto previene el error "RSV1 must be clear" cuando ngrok o el cliente envía frames comprimidos
      const originalOn = rawSock.on.bind(rawSock)
      let dataInterceptor: ((chunk: Buffer) => Buffer) | null = null
      
      // Interceptar el evento 'data' para limpiar RSV1
      const originalEmit = rawSock.emit.bind(rawSock)
      rawSock.emit = function (event: string, ...args: any[]) {
        if (event === 'data' && args[0] instanceof Buffer) {
          const chunk = args[0] as Buffer
          // Limpiar bit RSV1 (bit 4 del primer byte) si está activado
          // El primer byte de un frame WebSocket tiene la estructura:
          // FIN(1) RSV1(1) RSV2(1) RSV3(1) OPCODE(4)
          if (chunk.length > 0) {
            const firstByte = chunk[0]
            // Si RSV1 está activado (bit 4 = 0x40), limpiarlo
            if (firstByte & 0x40) {
              const cleaned = Buffer.from(chunk)
              cleaned[0] = firstByte & 0xbf // Limpiar bit RSV1 (0xbf = ~0x40)
              logger.debug?.('[WS PANEL] cleaned_rsv1_bit', {
                connId,
                sessionId,
                original: firstByte.toString(16),
                cleaned: cleaned[0].toString(16),
              })
              return originalEmit.call(this, event, cleaned, ...args.slice(1))
            }
          }
        }
        return originalEmit.call(this, event, ...args)
      }
      
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
      // ---------------------------
      // Parse URL + sessionId
      // ---------------------------
      const host = getHeader(req, 'host') ?? 'localhost'
      const rawUrl = req.url ?? ''
      const url = new URL(rawUrl, `http://${host}`)

      sessionId = url.searchParams.get('sessionId') || null
      const sid = sessionId ?? ''

      const ip = getClientIp(req, ws)
      const h = pickHeaders(req)

      const negotiatedExtensions = (ws as any).extensions ?? null
      
      logger.info('[WS PANEL] connection', {
        connId,
        sessionId,
        ip,
        url: rawUrl,
        path: url.pathname,
        headers: h,
        negotiatedProtocol: (ws as any).protocol ?? null,
        negotiatedExtensions,
        wsReadyState: ws.readyState,
      })

      // ---------------------------
      // Validaciones duras
      // ---------------------------
      // Ya no rechazamos extensiones porque ahora aceptamos compresión para ngrok
      // if (negotiatedExtensions) {
      //   logger.warn('[WS PANEL] reject_extensions_negotiated', {
      //     connId,
      //     sessionId,
      //     negotiatedExtensions,
      //   })
      //   closeOnce(1008, 'Extensions not supported')
      //   return
      // }
      
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

      // ---------------------------
      // Attach socket to session
      // ---------------------------
      const s = sessions.setPanelSocket(sid, ws as any)
      if (!s) {
        logger.warn('[WS PANEL] invalid_session_on_connection', { connId, sessionId })
        closeOnce(1008, 'Invalid sessionId')
        return
      }

      // ---------------------------
      // Send SESSION_STARTED (NO compression)
      // + seq counter to catch the 2nd frame that breaks
      // ---------------------------
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

      logger.info('[WS PANEL] session_attached', {
        connId,
        sessionId,
        callId: s.callId,
      })

      // ---------------------------
      // Heartbeat
      // ---------------------------
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

      // ---------------------------
      // WS events
      // ---------------------------
      ws.on('error', (err) => {
        const e = err instanceof Error ? err : new Error(String(err))
        const errorMsg = e.message.toLowerCase()
        
        // Manejo específico para error RSV1 (compresión no soportada)
        if (errorMsg.includes('rsv1') || errorMsg.includes('rsv') || errorMsg.includes('invalid websocket frame')) {
          logger.warn('[WS PANEL] socket_error_rsv1_compression', {
            connId,
            sessionId,
            errorName: e.name,
            errorMessage: e.message,
            negotiatedExtensions: (ws as any).extensions ?? null,
          })
          closeOnce(1008, 'Compression not supported')
          return
        }
        
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
    server: httpServer,
    path: '/ws/media',
    perMessageDeflate: false,
    maxPayload: 1024 * 1024,
  })

  const streamToSession = new Map<string, string>()

  //Heartbeat tipado sin tocar WebSocket: WeakMap
  const aliveMap = new WeakMap<WebSocket, boolean>()

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

    //heartbeat (pong => alive)
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

          //actividad real => alive
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
  return createGateway(deps.sessions, deps.logger)
}
