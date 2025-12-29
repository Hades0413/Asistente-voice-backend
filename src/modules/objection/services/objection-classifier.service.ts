export type ObjectionClassification = {
  type: string
  confidence: number
  reason: string
  entities?: Record<string, string | number | boolean>
}

export interface LlmProvider {
  classifyObjection(input: {
    text: string
    context: string[]
    candidates: string[]
  }): Promise<ObjectionClassification>
}

export class ObjectionClassifierService {
  constructor(private readonly llm: LlmProvider) {}

  async classify(text: string, context: string[], candidates: string[]) {
    return this.llm.classifyObjection({ text, context, candidates })
  }
}
