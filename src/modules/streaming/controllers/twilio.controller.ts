import { Request, Response } from 'express'
import twilio from 'twilio'

export class TwilioController {
  voiceWebhook = (req: Request, res: Response) => {
    const rawSessionId = req.query.sessionId

    if (typeof rawSessionId !== 'string' || !rawSessionId.trim()) {
      return res.status(400).send('Missing sessionId')
    }

    const sessionId = rawSessionId

    const baseUrl = process.env.PUBLIC_URL ?? ''
    if (!baseUrl) return res.status(500).send('Missing PUBLIC_URL')

    //Twilio requiere wss en <Stream url="...">
    const wsUrl = baseUrl.replace(/^http:/, 'ws:').replace(/^https:/, 'wss:') + '/ws/media'

    const vr = new twilio.twiml.VoiceResponse()

    const start = vr.start()
    const stream = start.stream({
      url: wsUrl,
      track: 'inbound_track',
    })

    //pasar sessionId por Custom Parameters (NO query string)
    stream.parameter({ name: 'sessionId', value: sessionId })

    // Mantener la llamada viva (silencio)
    vr.pause({ length: 600 })

    res.type('text/xml').send(vr.toString())
  }
}
