import { randomUUID } from 'node:crypto'
import type WebSocket from 'ws'

export type SessionMemory = {
  lastUtterances: { text: string; ts: number }[]
  runningSummary: string
  cooldown: Record<string, number>
}

export type StreamingSession = {
  sessionId: string
  callId: string
  phoneNumber: string
  agentId?: string
  providerCallId?: string
  wsPanel?: WebSocket
  createdAt: number
  memory: SessionMemory
}

export class StreamingSessionService {
  private readonly sessions = new Map<string, StreamingSession>()

  create(params: { phoneNumber: string; agentId?: string }) {
    const sessionId = randomUUID()
    const callId = randomUUID()

    const session: StreamingSession = {
      sessionId,
      callId,
      phoneNumber: params.phoneNumber,
      agentId: params.agentId,
      createdAt: Date.now(),
      memory: {
        lastUtterances: [],
        runningSummary: '',
        cooldown: {},
      },
    }

    this.sessions.set(sessionId, session)
    return session
  }

  get(sessionId: string) {
    return this.sessions.get(sessionId)
  }

  setPanelSocket(sessionId: string, ws: WebSocket) {
    const s = this.sessions.get(sessionId)
    if (!s) return null
    s.wsPanel = ws
    return s
  }

  setProviderCallId(sessionId: string, providerCallId: string) {
    const s = this.sessions.get(sessionId)
    if (!s) return
    s.providerCallId = providerCallId
  }

  close(sessionId: string) {
    const s = this.sessions.get(sessionId)

    const ws = s?.wsPanel
    if (ws && ws.readyState === ws.OPEN) {
      try {
        ws.close(1000, 'Session closed')
      } catch {
        // no-op
      }
    }

    this.sessions.delete(sessionId)
  }
}
