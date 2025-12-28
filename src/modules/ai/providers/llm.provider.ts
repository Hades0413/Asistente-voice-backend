// src/modules/ai/providers/llm.provider.ts

export type ObjectionClassification = {
  type: string
  confidence: number
  reason: string
  entities?: Record<string, any>
}

export interface LlmClassifierPort {
  classifyObjection(input: {
    text: string
    context: string[]
    candidates: string[]
  }): Promise<ObjectionClassification>
}

export type SuggestionResult = {
  type: string
  confidence: number
  text: string
}

export class LlmProvider implements LlmClassifierPort {
  // Aquí conectarás OpenAI real
  constructor(private readonly apiKey?: string) {}

  async classifyObjection(input: { text: string; context: string[]; candidates: string[] }) {
    // MVP: decisión simple (para no romper) + luego lo reemplazas por llamada real
    const t = input.text.toLowerCase()
    const pick =
      input.candidates.find((c) => c === 'PRICE_HIGH' && /car|presupuesto|alto/.test(t)) ??
      input.candidates[0] ??
      'OTHER'

    const result: ObjectionClassification = {
      type: pick,
      confidence: 0.8,
      reason: 'keyword+heuristic',
      entities: {},
    }

    return result
  }

  async generateSuggestion(input: {
    objectionType: string
    snippets: { title: string; text: string }[]
    lastUserText: string
  }): Promise<SuggestionResult> {
    const base =
      input.snippets[0]?.text ??
      'Haz una pregunta para entender mejor y ofrece un siguiente paso claro.'

    return {
      type: input.objectionType,
      confidence: 0.85,
      text: `${base}\nCierre: ¿Te parece si lo vemos en 2 minutos y decides?`,
    }
  }
}
