import { SttService } from '../../../../infra/stt/stt.service'
import { VoipService } from '../../../../infra/voip/voip.service'
import { StreamingProcessorService } from '../domain/streaming-processor.service'
import { StreamingSessionService } from './streaming-session.service'

type StartCallInput = {
  phoneNumber: string
  agentId?: string
}

type StartCallOutput = {
  sessionId: string
  callId: string

  panelWsPath: string
  panelWsUrl: string

  providerCallId: string
}

type LogCtx = Record<string, unknown>

export class StreamingService {
  constructor(
    private readonly sessions: StreamingSessionService,
    private readonly voip: VoipService,
    private readonly stt: SttService,
    private readonly processor: StreamingProcessorService
  ) {}

  private logInfo(event: string, ctx: LogCtx = {}) {
    console.info('[STREAMING]', event, ctx)
  }

  private logWarn(event: string, ctx: LogCtx = {}) {
    console.warn('[STREAMING]', event, ctx)
  }

  private logError(event: string, err: unknown, ctx: LogCtx = {}) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[STREAMING]', event, {
      ...ctx,
      errorName: e.name,
      errorMessage: e.message,
      errorStack: e.stack,
    })
  }

  private previewText(text: string, max = 200) {
    if (text.length <= max) return text
    return `${text.slice(0, max)}…`
  }

  async startCall(params: StartCallInput): Promise<StartCallOutput> {
    const op = 'startCall'
    const startedAt = Date.now()

    const session = this.sessions.create({
      phoneNumber: params.phoneNumber,
      agentId: params.agentId,
    })

    this.logInfo(`${op}.session_created`, {
      sessionId: session.sessionId,
      callId: session.callId,
      phoneNumber: params.phoneNumber,
      agentId: params.agentId ?? null,
    })

    try {
      this.logInfo(`${op}.stt_starting`, { sessionId: session.sessionId })

      await this.stt.start(session.sessionId, {
        onPartial: (text) => {
          console.debug('[STT]', 'partial', {
            sessionId: session.sessionId,
            len: text?.length ?? 0,
          })
          this.processor.onPartial(session.sessionId, text)
        },

        onFinal: (text) => {
          this.logInfo('stt.final', {
            sessionId: session.sessionId,
            len: text?.length ?? 0,
            text: this.previewText(text ?? '', 200),
          })

          this.processor.onFinal(session.sessionId, text).catch((err) => {
            try {
              this.processor.onPartial(session.sessionId, '')
            } catch (e) {
              this.logWarn('processor.onPartial_noop_failed', {
                sessionId: session.sessionId,
                message: e instanceof Error ? e.message : String(e),
              })
            }

            this.logError('processor.onFinal_failed', err, { sessionId: session.sessionId })
          })
        },

        onError: (err) => {
          this.logError('stt.error', err, { sessionId: session.sessionId })

          try {
            this.processor.onPartial(session.sessionId, '')
          } catch (e) {
            this.logWarn('processor.onPartial_noop_failed', {
              sessionId: session.sessionId,
              message: e instanceof Error ? e.message : String(e),
            })
          }
        },
      })

      this.logInfo(`${op}.stt_started`, { sessionId: session.sessionId })
    } catch (err) {
      this.logError(`${op}.stt_start_failed`, err, { sessionId: session.sessionId })
      await this.safeStop(session.sessionId, 'STT_START_FAILED')
      throw err
    }

    let providerCallId = ''
    try {
      this.logInfo(`${op}.voip_starting`, {
        sessionId: session.sessionId,
        phoneNumber: params.phoneNumber,
      })

      const started = await this.voip.startCall({
        phoneNumber: params.phoneNumber,
        sessionId: session.sessionId,
      })

      providerCallId = started.providerCallId
      this.sessions.setProviderCallId(session.sessionId, providerCallId)

      this.logInfo(`${op}.voip_started`, {
        sessionId: session.sessionId,
        providerCallId,
      })
    } catch (err) {
      this.logError(`${op}.voip_start_failed`, err, { sessionId: session.sessionId })
      await this.safeStop(session.sessionId, 'VOIP_START_FAILED')
      throw err
    }

    const panelWsPath = `/ws/panel?sessionId=${session.sessionId}`

    const basePublicUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`

    const panelWsUrl =
      basePublicUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + panelWsPath

    this.logInfo(`${op}.panel_ws_ready`, {
      sessionId: session.sessionId,
      panelWsPath,
      panelWsUrl,
      basePublicUrl,
    })

    this.logInfo(`${op}.done`, {
      sessionId: session.sessionId,
      ms: Date.now() - startedAt,
    })

    return {
      sessionId: session.sessionId,
      callId: session.callId,
      panelWsPath,
      panelWsUrl,
      providerCallId,
    }
  }

  async endCall(sessionId: string, reason?: string) {
    const op = 'endCall'
    const startedAt = Date.now()

    this.logInfo(`${op}.requested`, { sessionId, reason: reason ?? null })

    const s = this.sessions.get(sessionId)
    if (!s) {
      this.logWarn(`${op}.session_not_found`, { sessionId })
      return
    }

    if (s.providerCallId) {
      try {
        this.logInfo(`${op}.voip_ending`, {
          sessionId,
          providerCallId: s.providerCallId,
        })
        await this.voip.endCall(s.providerCallId)
        this.logInfo(`${op}.voip_ended`, {
          sessionId,
          providerCallId: s.providerCallId,
        })
      } catch (err) {
        this.logError(`${op}.voip_end_failed`, err, {
          sessionId,
          providerCallId: s.providerCallId,
        })
      }
    } else {
      this.logInfo(`${op}.voip_skip_no_providerCallId`, { sessionId })
    }

    try {
      this.logInfo(`${op}.stt_stopping`, { sessionId })
      await this.stt.stop(sessionId)
      this.logInfo(`${op}.stt_stopped`, { sessionId })
    } catch (err) {
      this.logError(`${op}.stt_stop_failed`, err, { sessionId })
    }

    try {
      this.logInfo(`${op}.processor_ending`, { sessionId, reason: reason ?? null })
      this.processor.end(sessionId, reason)
      this.logInfo(`${op}.processor_ended`, { sessionId })
    } catch (err) {
      this.logError(`${op}.processor_end_failed`, err, { sessionId })
    }

    try {
      this.sessions.close(sessionId)
      this.logInfo(`${op}.session_closed`, {
        sessionId,
        ms: Date.now() - startedAt,
      })
    } catch (err) {
      this.logError(`${op}.session_close_failed`, err, { sessionId })
    }
  }

  private async safeStop(sessionId: string, reason: string) {
    const op = 'safeStop'
    const startedAt = Date.now()

    this.logWarn(`${op}.starting`, { sessionId, reason })

    try {
      await this.stt.stop(sessionId)
      this.logInfo(`${op}.stt_stopped`, { sessionId })
    } catch (err) {
      this.logError(`${op}.stt_stop_failed`, err, { sessionId })
    }

    try {
      this.processor.end(sessionId, reason)
      this.logInfo(`${op}.processor_ended`, { sessionId, reason })
    } catch (err) {
      this.logError(`${op}.processor_end_failed`, err, { sessionId })
    }

    try {
      this.sessions.close(sessionId)
      this.logInfo(`${op}.session_closed`, {
        sessionId,
        ms: Date.now() - startedAt,
      })
    } catch (err) {
      this.logError(`${op}.session_close_failed`, err, { sessionId })
    }
  }
}
