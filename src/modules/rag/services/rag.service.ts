export class RagService {
  async retrieve(type: string) {
    // MVP: KB simple, luego cambias por Qdrant/Pinecone sin romper nada
    const kb: Record<string, { title: string; text: string }[]> = {
      PRICE_HIGH: [
        {
          title: 'Valor',
          text: 'Entiendo. Lo importante es el retorno: con X reduces Y en Z%. ¿Qué presupuesto tenías pensado?',
        },
        {
          title: 'Plan',
          text: 'Podemos comenzar con un plan básico y escalar cuando veas resultados.',
        },
      ],
      CALL_LATER: [
        {
          title: 'Agendar',
          text: 'Perfecto. ¿Te va mejor hoy 6pm o mañana 10am? Te mando un resumen breve.',
        },
      ],
      NO_INTEREST: [
        {
          title: 'Indagar',
          text: 'Antes de cerrar, ¿qué objetivo estabas buscando resolver? Así veo si tiene sentido.',
        },
      ],
      NEED_APPROVAL: [
        {
          title: 'Aprobación',
          text: 'Te dejo un resumen con beneficios y números. ¿Quién decide y cuándo lo revisan?',
        },
      ],
    }

    return { snippets: kb[type] ?? [] }
  }
}
