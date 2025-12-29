import { Request, Response } from 'express'
import twilio from 'twilio'

type LogCtx = Record<string, unknown>

export class TwilioController {
  private logInfo(event: string, ctx: LogCtx = {}) {
    console.info('[TWILIO]', event, ctx)
  }

  private logWarn(event: string, ctx: LogCtx = {}) {
    console.warn('[TWILIO]', event, ctx)
  }

  private logError(event: string, err: unknown, ctx: LogCtx = {}) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[TWILIO]', event, {
      ...ctx,
      errorName: e.name,
      errorMessage: e.message,
      errorStack: e.stack,
    })
  }

  voiceWebhook = (req: Request, res: Response) => {
    const op = 'voiceWebhook'
    const startedAt = Date.now()

    this.logInfo(`${op}.requested`, {
      query: req.query,
      from: req.body?.From,
      to: req.body?.To,
      callSid: req.body?.CallSid,
    })

    const rawSessionId = req.query.sessionId

    if (typeof rawSessionId !== 'string' || !rawSessionId.trim()) {
      this.logWarn(`${op}.missing_sessionId`, {
        received: rawSessionId,
      })
      return res.status(400).send('Missing sessionId')
    }

    const sessionId = rawSessionId.trim()

    const baseUrl = process.env.PUBLIC_URL ?? ''
    if (!baseUrl) {
      this.logError(`${op}.missing_public_url`, new Error('PUBLIC_URL not defined'), {
        sessionId,
      })
      return res.status(500).send('Missing PUBLIC_URL')
    }

    const wsUrl = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws/media'

    this.logInfo(`${op}.stream_config`, {
      sessionId,
      baseUrl,
      wsUrl,
    })

    try {
      const vr = new twilio.twiml.VoiceResponse()

      const start = vr.start()
      const stream = start.stream({
        url: wsUrl,
        track: 'inbound_track',
      })

      stream.parameter({ name: 'sessionId', value: sessionId })

      this.logInfo(`${op}.stream_started`, {
        sessionId,
        track: 'inbound_track',
      })

      vr.pause({ length: 600 })

      const xml = vr.toString()

      this.logInfo(`${op}.response_ready`, {
        sessionId,
        xmlLength: xml.length,
        ms: Date.now() - startedAt,
      })

      res.type('text/xml').send(xml)
    } catch (err) {
      this.logError(`${op}.twiml_generation_failed`, err, {
        sessionId,
      })
      res.status(500).send('Failed to generate TwiML')
    }
  }
}
