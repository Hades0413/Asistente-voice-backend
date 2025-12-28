import WebSocket from 'ws'

export type SttCallbacks = {
  onPartial: (text: string) => void
  onFinal: (text: string) => void
  onError?: (err: Error) => void
}

type SessionState = {
  dg: WebSocket
  callbacks: SttCallbacks
}

export class SttService {
  private readonly sessions = new Map<string, SessionState>()
  private readonly apiKey = process.env.DEEPGRAM_API_KEY ?? ''

  async start(sessionId: string, callbacks: SttCallbacks) {
    if (!this.apiKey) throw new Error('DEEPGRAM_API_KEY is missing')

    const dgUrl =
      'wss://api.deepgram.com/v1/listen' +
      '?model=nova-2' +
      '&language=es' +
      '&punctuate=true' +
      '&interim_results=true' +
      '&encoding=mulaw' +
      '&sample_rate=8000' +
      '&channels=1'

    const dg = new WebSocket(dgUrl, {
      headers: { Authorization: `Token ${this.apiKey}` },
    })

    dg.on('open', () => {
      this.sessions.set(sessionId, { dg, callbacks })
    })

    dg.on('message', (data) => {
      try {
        let jsonString: string

        if (typeof data === 'string') {
          jsonString = data
        } else if (Buffer.isBuffer(data)) {
          jsonString = data.toString('utf8')
        } else if (Array.isArray(data)) {
          jsonString = Buffer.concat(data).toString('utf8')
        } else if (data instanceof ArrayBuffer) {
          jsonString = Buffer.from(data).toString('utf8')
        } else {
          // fallback defensivo
          return
        }

        const msg = JSON.parse(jsonString)

        const alt = msg?.channel?.alternatives?.[0]
        const transcript: string = alt?.transcript ?? ''
        if (!transcript) return

        const isFinal = Boolean(msg?.is_final)
        if (isFinal) callbacks.onFinal(transcript)
        else callbacks.onPartial(transcript)
      } catch (err: any) {
        callbacks.onError?.(err)
      }
    })

    dg.on('error', (err) => callbacks.onError?.(err as any))
    dg.on('close', () => this.sessions.delete(sessionId))
  }

  async pushAudio(sessionId: string, chunk: Buffer) {
    const s = this.sessions.get(sessionId)
    if (!s) return
    if (s.dg.readyState !== WebSocket.OPEN) return
    s.dg.send(chunk)
  }

  async stop(sessionId: string) {
    const s = this.sessions.get(sessionId)
    if (!s) return
    try {
      s.dg.close()
    } finally {
      this.sessions.delete(sessionId)
    }
  }
}
