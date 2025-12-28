import logger from './shared/logger'

// -------------------------
// Infra
// -------------------------
import { SttService } from './infra/stt/stt.service'
import { VoipService } from './infra/voip/voip.service'

// -------------------------
// Streaming / Sessions
// -------------------------
import { StreamingSessionService } from './modules/streaming/services/application/streaming-session.service'
import { StreamingService } from './modules/streaming/services/application/streaming.service'
import { StreamingProcessorService } from './modules/streaming/services/domain/streaming-processor.service'

// -------------------------
// Objections (Hybrid: keywords + LLM)
// -------------------------
import { KeywordTriggerService } from './modules/objection/services/keyword-trigger.service'
import { ObjectionClassifierService } from './modules/objection/services/objection-classifier.service'
import { ObjectionDetectorService } from './modules/objection/services/objection-detector.service'

// -------------------------
// AI / RAG / Summary
// -------------------------
import { LlmProvider } from './modules/ai/providers/llm.provider'
import { AiSuggestionService } from './modules/ai/services/application/ai-suggestion.service'
import { CallSummaryService } from './modules/call/services/application/call-summary.service'
import { RagService } from './modules/rag/services/rag.service'

// -------------------------
// WebSocket Gateway (inyectado luego)
// -------------------------
import type { WsGateway } from './infra/websocket/ws.server'

/**
 * NOTA IMPORTANTE:
 * - container.ts NO inicia HTTP ni WebSocket
 * - index.ts inicia HTTP + WS y luego inyecta wsGateway aquí
 */

// -------------------------
// Singletons base
// -------------------------
const sessions = new StreamingSessionService()
const stt = new SttService()

const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`

const voip = new VoipService(publicUrl)

// -------------------------
// AI base
// -------------------------
const llm = new LlmProvider(process.env.OPENAI_API_KEY)
const rag = new RagService()
const summary = new CallSummaryService()

// -------------------------
// Objection pipeline
// -------------------------
const trigger = new KeywordTriggerService()
const classifier = new ObjectionClassifierService(llm)
const objection = new ObjectionDetectorService(trigger, classifier)

// -------------------------
// AI suggestion
// -------------------------
const aiSuggestion = new AiSuggestionService(llm)

// -------------------------
// Processor & StreamingService
// (se completan cuando WS esté listo)
// -------------------------
let processor: StreamingProcessorService | null = null
let streamingService: StreamingService | null = null

// -------------------------
// Container exportado
// -------------------------
export const container = {
  // Infra
  stt,
  voip,

  // Sessions
  sessions,

  // AI
  llm,
  rag,
  summary,
  aiSuggestion,

  // Objections
  trigger,
  classifier,
  objection,

  // Runtime (inyectados después)
  get processor() {
    if (!processor) {
      throw new Error('StreamingProcessorService not initialized yet')
    }
    return processor
  },

  get streamingService() {
    if (!streamingService) {
      throw new Error('StreamingService not initialized yet')
    }
    return streamingService
  },

  /**
   *Se llama UNA SOLA VEZ desde index.ts
   * cuando el WebSocket server ya está listo
   */
  initStreaming(wsGateway: WsGateway) {
    if (processor || streamingService) {
      logger.warn('Streaming already initialized')
      return
    }

    processor = new StreamingProcessorService(
      sessions,
      wsGateway,
      objection,
      rag,
      aiSuggestion,
      summary
    )

    streamingService = new StreamingService(sessions, voip, stt, processor)

    logger.info('Streaming pipeline initialized')
  },
}
