import { LlmProvider } from '../../providers/llm.provider'

export class AiSuggestionService {
  constructor(private readonly llm: LlmProvider) {}

  generate(params: {
    objectionType: string
    snippets: { title: string; text: string }[]
    lastUserText: string
  }) {
    return this.llm.generateSuggestion(params)
  }
}
