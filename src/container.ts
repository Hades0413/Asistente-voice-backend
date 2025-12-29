import logger from './shared/logger'

import { SttService } from './infra/stt/stt.service'
import { VoipService } from './infra/voip/voip.service'

import { StreamingSessionService } from './modules/streaming/services/application/streaming-session.service'
import { StreamingService } from './modules/streaming/services/application/streaming.service'
import { StreamingProcessorService } from './modules/streaming/services/domain/streaming-processor.service'

import { KeywordTriggerService } from './modules/objection/services/keyword-trigger.service'
import { ObjectionClassifierService } from './modules/objection/services/objection-classifier.service'
import { ObjectionDetectorService } from './modules/objection/services/objection-detector.service'

import { LlmProvider } from './modules/ai/providers/llm.provider'
import { AiSuggestionService } from './modules/ai/services/application/ai-suggestion.service'
import { CallSummaryService } from './modules/call/services/application/call-summary.service'
import { RagService } from './modules/rag/services/rag.service'

import type { WsGateway } from './infra/websocket/ws.server'

const sessions = new StreamingSessionService()
const stt = new SttService()

const publicUrl = process.env.PUBLIC_URL ?? `http://localhost:${process.env.PORT ?? 3000}`

const voip = new VoipService(publicUrl)

const llm = new LlmProvider(process.env.OPENAI_API_KEY)
const rag = new RagService()
const summary = new CallSummaryService()

const trigger = new KeywordTriggerService()
const classifier = new ObjectionClassifierService(llm)
const objection = new ObjectionDetectorService(trigger, classifier)

const aiSuggestion = new AiSuggestionService(llm)

let processor: StreamingProcessorService | null = null
let streamingService: StreamingService | null = null

export const container = {
  stt,
  voip,
  sessions,
  llm,
  rag,
  summary,
  aiSuggestion,
  trigger,
  classifier,
  objection,

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
