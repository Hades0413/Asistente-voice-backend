import { KeywordTriggerService } from './keyword-trigger.service'
import { ObjectionClassifierService } from './objection-classifier.service'

export class ObjectionDetectorService {
  constructor(
    private readonly trigger: KeywordTriggerService,
    private readonly classifier: ObjectionClassifierService
  ) {}

  async detect(params: { text: string; context: string[]; cooldown: Record<string, number> }) {
    const candidates = this.trigger.detectCandidates(params.text)
    if (!candidates.length) return null

    // cooldown por tipo (15s)
    const now = Date.now()
    const candidateTypes = candidates.map((c) => c.candidate)
    const blocked = candidateTypes.some((t) => now - (params.cooldown[`obj_${t}`] ?? 0) < 15000)
    if (blocked) return null

    const result = await this.classifier.classify(params.text, params.context, candidateTypes)
    if (!result || result.confidence < 0.7) return null

    params.cooldown[`obj_${result.type}`] = now
    return result
  }
}
