import twilio from 'twilio'

export type StartCallResult = {
  providerCallId: string
}

type LogCtx = Record<string, unknown>

export class VoipService {
  private readonly client?: twilio.Twilio

  constructor(private readonly basePublicUrl: string) {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN

    if (sid && token) {
      this.client = twilio(sid, token)
      this.logInfo('init.success', {
        accountSidPrefix: `${sid.slice(0, 6)}…`,
      })
    } else {
      this.logWarn('init.missing_credentials', {
        hasAccountSid: Boolean(sid),
        hasAuthToken: Boolean(token),
      })
    }
  }

  private logInfo(event: string, ctx: LogCtx = {}) {
    console.info('[VOIP]', event, ctx)
  }

  private logWarn(event: string, ctx: LogCtx = {}) {
    console.warn('[VOIP]', event, ctx)
  }

  private logError(event: string, err: unknown, ctx: LogCtx = {}) {
    const e = err instanceof Error ? err : new Error(String(err))
    console.error('[VOIP]', event, {
      ...ctx,
      errorName: e.name,
      errorMessage: e.message,
      errorStack: e.stack,
    })
  }

  private requireClient(): twilio.Twilio {
    if (!this.client) {
      const err = new Error('Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
      this.logError('requireClient.failed', err)
      throw err
    }
    return this.client
  }

  async startCall(params: { phoneNumber: string; sessionId: string }): Promise<StartCallResult> {
    const op = 'startCall'
    const startedAt = Date.now()

    this.logInfo(`${op}.requested`, {
      sessionId: params.sessionId,
      phoneNumber: params.phoneNumber,
    })

    const from = process.env.TWILIO_FROM_NUMBER
    if (!from) {
      const err = new Error('TWILIO_FROM_NUMBER missing')
      this.logError(`${op}.missing_from_number`, err, {
        sessionId: params.sessionId,
      })
      throw err
    }

    const client = this.requireClient()

    const twimlWebhookUrl = `${this.basePublicUrl}/twilio/voice?sessionId=${params.sessionId}`

    this.logInfo(`${op}.twiml_webhook_ready`, {
      sessionId: params.sessionId,
      from,
      to: params.phoneNumber,
      twimlWebhookUrl,
    })

    try {
      const call = await client.calls.create({
        to: params.phoneNumber,
        from,
        url: twimlWebhookUrl,
        method: 'POST',
      })

      this.logInfo(`${op}.call_started`, {
        sessionId: params.sessionId,
        providerCallId: call.sid,
        status: call.status,
        ms: Date.now() - startedAt,
      })

      return { providerCallId: call.sid }
    } catch (err) {
      this.logError(`${op}.call_start_failed`, err, {
        sessionId: params.sessionId,
        from,
        to: params.phoneNumber,
      })
      throw err
    }
  }

  async endCall(providerCallId: string) {
    const op = 'endCall'
    const startedAt = Date.now()

    this.logInfo(`${op}.requested`, {
      providerCallId,
    })

    const client = this.requireClient()

    try {
      const call = await client.calls(providerCallId).update({
        status: 'completed',
      })

      this.logInfo(`${op}.call_completed`, {
        providerCallId,
        finalStatus: call.status,
        ms: Date.now() - startedAt,
      })
    } catch (err) {
      this.logError(`${op}.call_end_failed`, err, {
        providerCallId,
      })
      throw err
    }
  }
}
