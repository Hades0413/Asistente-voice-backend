import type { WsGateway } from '../../../../infra/websocket/ws.server'
import { AiSuggestionService } from '../../../ai/services/application/ai-suggestion.service'
import { CallSummaryService } from '../../../call/services/application/call-summary.service'
import { ObjectionDetectorService } from '../../../objection/services/objection-detector.service'
import { RagService } from '../../../rag/services/rag.service'
import { StreamingSessionService } from '../application/streaming-session.service'

export class StreamingProcessorService {
  constructor(
    private readonly sessions: StreamingSessionService,
    private readonly ws: WsGateway,
    private readonly objection: ObjectionDetectorService,
    private readonly rag: RagService,
    private readonly aiSuggestion: AiSuggestionService,
    private readonly summary: CallSummaryService
  ) {}

  onPartial(sessionId: string, text: string) {
    this.ws.send(sessionId, 'TRANSCRIPT_PARTIAL', { text, ts: Date.now() })
  }

  async onFinal(sessionId: string, text: string) {
    const s = this.sessions.get(sessionId)
    if (!s) return

    const ts = Date.now()
    s.memory.lastUtterances.push({ text, ts })
    if (s.memory.lastUtterances.length > 12) s.memory.lastUtterances.shift()

    this.ws.send(sessionId, 'TRANSCRIPT_FINAL', { text, ts })

    s.memory.runningSummary = this.summary.incremental(s.memory.runningSummary, text)
    this.ws.send(sessionId, 'SUMMARY_UPDATE', { text: s.memory.runningSummary })

    const context = s.memory.lastUtterances.slice(-10).map((x) => x.text)
    const hit = await this.objection.detect({ text, context, cooldown: s.memory.cooldown })
    if (!hit) return

    this.ws.send(sessionId, 'OBJECTION_DETECTED', hit)

    const ragCtx = await this.rag.retrieve(hit.type)
    this.ws.send(sessionId, 'RAG_CONTEXT', { type: hit.type, snippets: ragCtx.snippets })

    const suggestion = await this.aiSuggestion.generate({
      objectionType: hit.type,
      snippets: ragCtx.snippets,
      lastUserText: text,
    })

    this.ws.send(sessionId, 'SUGGESTION', suggestion)
  }

  end(sessionId: string, reason?: string) {
    const s = this.sessions.get(sessionId)
    if (!s) return
    const finalSummary = this.summary.finalize(s.memory.runningSummary)
    this.ws.send(sessionId, 'SUMMARY_FINAL', { text: finalSummary, reason })
  }
}
