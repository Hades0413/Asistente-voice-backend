import { StreamingSessionService } from './streaming-session.service'
import { VoipService } from '../../../../infra/voip/voip.service'
import { SttService } from '../../../../infra/stt/stt.service'
import { StreamingProcessorService } from '../domain/streaming-processor.service'

type StartCallInput = {
  phoneNumber: string
  agentId?: string
}

type StartCallOutput = {
  sessionId: string
  callId: string

  /** URL para que tu frontend conecte al panel WS */
  panelWsPath: string
  panelWsUrl: string

  /** CallSid de Twilio */
  providerCallId: string
}

export class StreamingService {
  constructor(
    private readonly sessions: StreamingSessionService,
    private readonly voip: VoipService,
    private readonly stt: SttService,
    private readonly processor: StreamingProcessorService
  ) {}

  async startCall(params: StartCallInput): Promise<StartCallOutput> {
    // 1) Crear sesión
    const session = this.sessions.create({
      phoneNumber: params.phoneNumber,
      agentId: params.agentId,
    })

    // 2) Arrancar STT ANTES de la llamada (para no perder el primer audio)
    await this.stt.start(session.sessionId, {
      onPartial: (text) => {
        // Sonar: no retornar Promise aquí
        this.processor.onPartial(session.sessionId, text)
      },
      onFinal: (text) => {
        // processor.onFinal es async, pero el callback espera void.
        // Disparamos y atrapamos error.
        this.processor.onFinal(session.sessionId, text).catch((err) => {
          this.processor.onPartial(session.sessionId, '') // no-op defensivo
          // Notificar al panel que algo falló procesando IA
          // (si quieres un evento específico, aquí es el lugar)
          // Igual no reventamos el stream
          // eslint-disable-next-line no-console
          console.warn('[STREAMING] processor.onFinal failed', err)
        })
      },
      onError: (err) => {
        // Notificar al panel (mínimo)
        try {
          this.processor.onPartial(session.sessionId, '')
          // Podrías añadir un evento WS: STT_ERROR (si lo soportas en el frontend)
          // Ej: this.processor.ws.send(session.sessionId, 'STT_ERROR', { message: err.message })
          // Como processor.ws es privado, usa processor.end o crea un método notifyError si quieres.
          // Por ahora dejamos el warning.
          // eslint-disable-next-line no-console
          console.warn('[STT] error', err)
        } catch {
          // no-op
        }
      },
    })

    // 3) Iniciar llamada con Twilio
    let providerCallId = ''
    try {
      const started = await this.voip.startCall({
        phoneNumber: params.phoneNumber,
        sessionId: session.sessionId,
      })

      providerCallId = started.providerCallId
      this.sessions.setProviderCallId(session.sessionId, providerCallId)
    } catch (err) {
      // Si falla la llamada, apaga STT y cierra sesión
      await this.safeStop(session.sessionId, 'VOIP_START_FAILED')
      throw err
    }

    // 4) URL WS del panel (para tu frontend)
    // Devolvemos tanto path como URL absoluta (útil cuando tu frontend está en otro dominio)
    const panelWsPath = `/ws/panel?sessionId=${session.sessionId}`

    // Si PUBLIC_URL es https -> panel debe ser wss
    // Si PUBLIC_URL es http -> panel ws
    const basePublicUrl =
      process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`
    const panelWsUrl = basePublicUrl
      .replace(/^http:/, 'ws:')
      .replace(/^https:/, 'wss:') + panelWsPath

    return {
      sessionId: session.sessionId,
      callId: session.callId,
      panelWsPath,
      panelWsUrl,
      providerCallId,
    }
  }

  async endCall(sessionId: string, reason?: string) {
    const s = this.sessions.get(sessionId)
    if (!s) return

    // 1) Colgar llamada si existe providerCallId
    if (s.providerCallId) {
      try {
        await this.voip.endCall(s.providerCallId)
      } catch (err) {
        // No bloquees cleanup por fallo de proveedor
        // eslint-disable-next-line no-console
        console.warn('[STREAMING] voip.endCall failed', err)
      }
    }

    // 2) Detener STT
    try {
      await this.stt.stop(sessionId)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[STREAMING] stt.stop failed', err)
    }

    // 3) Emitir resumen final / cierre
    try {
      this.processor.end(sessionId, reason)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[STREAMING] processor.end failed', err)
    }

    // 4) Cerrar sesión
    this.sessions.close(sessionId)
  }

  private async safeStop(sessionId: string, reason: string) {
    try {
      await this.stt.stop(sessionId)
    } catch {
      // no-op
    }
    try {
      this.processor.end(sessionId, reason)
    } catch {
      // no-op
    }
    this.sessions.close(sessionId)
  }
}
