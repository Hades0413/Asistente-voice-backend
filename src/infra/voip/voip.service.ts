import twilio from 'twilio'

export type StartCallResult = {
  providerCallId: string // CallSid
}

export class VoipService {
  private readonly client?: twilio.Twilio

  constructor(private readonly basePublicUrl: string) {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN

    if (sid && token) {
      this.client = twilio(sid, token)
    }
  }

  private requireClient(): twilio.Twilio {
    if (!this.client) {
      throw new Error('Twilio not configured (TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN)')
    }
    return this.client
  }

  async startCall(params: { phoneNumber: string; sessionId: string }): Promise<StartCallResult> {
    const from = process.env.TWILIO_FROM_NUMBER
    if (!from) throw new Error('TWILIO_FROM_NUMBER missing')

    const client = this.requireClient()

    const twimlWebhookUrl = `${this.basePublicUrl}/twilio/voice?sessionId=${params.sessionId}`

    const call = await client.calls.create({
      to: params.phoneNumber,
      from,
      url: twimlWebhookUrl,
      method: 'POST',
    })

    return { providerCallId: call.sid }
  }

  async endCall(providerCallId: string) {
    const client = this.requireClient()
    await client.calls(providerCallId).update({ status: 'completed' })
  }
}
