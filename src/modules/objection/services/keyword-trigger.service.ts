export type TriggerCandidate = {
  candidate: string
  evidence: string
  score: number
  matches: string[]
}

type PatternRule = {
  score: number
  re: RegExp
  note?: string
}

export class KeywordTriggerService {
  private readonly patterns: Record<string, PatternRule[]> = {
    PRICE_HIGH: [
      { score: 0.95, re: /\b(muy\s+caro|carísimo|carisimo)\b/i, note: 'frase explícita' },
      { score: 0.85, re: /\b(no\s+me\s+alcanza|se\s+me\s+sale\s+del\s+presupuesto)\b/i },
      { score: 0.75, re: /\bprecio\b.*\b(alto|elevado)\b/i },
      { score: 0.65, re: /\bpresupuesto\b/i, note: 'señal moderada' },
      { score: 0.6, re: /\bestá\s+caro\b/i },
    ],

    CALL_LATER: [
      { score: 0.95, re: /\b(ahora\s+no\s+puedo|no\s+puedo\s+ahorita)\b/i },
      { score: 0.85, re: /\b(llámame|llamame)\s+(luego|después|despues)\b/i },
      {
        score: 0.85,
        re: /\b(hablamos|conversamos)\s+(luego|después|despues|más\s+tarde|mas\s+tarde)\b/i,
      },
      { score: 0.8, re: /\b(otro\s+d[ií]a|en\s+otro\s+momento)\b/i },
      { score: 0.7, re: /\b(más\s+tarde|mas\s+tarde)\b/i, note: 'señal moderada' },
    ],

    NO_INTEREST: [
      { score: 0.95, re: /\b(no\s+me\s+interesa|no\s+me\s+interesan)\b/i },
      { score: 0.9, re: /\b(no\s+gracias|gracias,\s*no)\b/i },
      { score: 0.8, re: /\b(no\s+quiero|no\s+lo\s+necesito)\b/i },
    ],

    NEED_APPROVAL: [
      { score: 0.9, re: /\b(tengo\s+que\s+consultar|debo\s+consultar)\b/i },
      { score: 0.85, re: /\b(mi\s+jefe|mi\s+gerente|mi\s+supervisor)\b/i },
      { score: 0.85, re: /\b(necesito\s+aprobaci[oó]n|requiere\s+aprobaci[oó]n)\b/i },
      { score: 0.75, re: /\b(lo\s+reviso\s+con)\b/i },
    ],

    INFO_REQUEST: [
      { score: 0.95, re: /\b(m[eé]ndame|env[ií]ame|p[aá]same)\s+(info|informaci[oó]n)\b/i },
      { score: 0.9, re: /\b(info|informaci[oó]n)\s+(por\s+favor|pls|porfa)\b/i },
      { score: 0.9, re: /\b(tienes|tiene)\s+(info|informaci[oó]n|cat[aá]logo|brochure|pdf)\b/i },
      { score: 0.9, re: /\b(whatsapp|wsp|ws)\b/i },
      { score: 0.85, re: /\b(m[eé]ndalo|env[ií]alo)\s+por\s+(whatsapp|wsp|ws)\b/i },
      { score: 0.8, re: /\b(m[eé]ndame)\s+(un\s+mensaje|los\s+detalles|el\s+link|enlace)\b/i },
    ],

    CERTIFICATION: [
      { score: 0.95, re: /\b(iso|isos)\b/i, note: 'término relacionado con estándares' },
      {
        score: 0.9,
        re: /\b(certificado|certificados)\b/i,
        note: 'término relacionado con documentos oficiales',
      },
      {
        score: 0.85,
        re: /\b(validación|valido)\b/i,
        note: 'término relacionado con proceso de verificación',
      },
      { score: 0.8, re: /\b(inacal)\b/i, note: 'referencia al organismo de certificación' },
    ],
  }

  private readonly minCandidateScore = 0.65

  private readonly minTextLength = 6

  detectCandidates(text: string): TriggerCandidate[] {
    const cleaned = this.normalize(text)
    if (!cleaned || cleaned.length < this.minTextLength) return []
    if (this.isMostlyFiller(cleaned)) return []

    const out: TriggerCandidate[] = []

    for (const [candidate, rules] of Object.entries(this.patterns)) {
      let bestScore = 0
      const matches: string[] = []

      for (const rule of rules) {
        const m = rule.re.exec(cleaned)
        if (!m) continue

        matches.push(m[0])
        if (rule.score > bestScore) bestScore = rule.score
      }

      if (bestScore >= this.minCandidateScore) {
        out.push({
          candidate,
          evidence: text,
          score: Number(bestScore.toFixed(2)),
          matches,
        })
      }
    }

    out.sort((a, b) => b.score - a.score)
    return out
  }

  private normalize(input: string): string {
    return String(input ?? '')
      .trim()
      .replaceAll(/\s+/g as any, ' ')
  }

  private isMostlyFiller(text: string): boolean {
    const t = text.toLowerCase()

    const fillers = new Set([
      'ok',
      'oka',
      'ya',
      'sí',
      'si',
      'dale',
      'ajá',
      'aja',
      'mmm',
      'eh',
      'claro',
      'perfecto',
      'gracias',
    ])

    if (fillers.has(t)) return true

    const lettersOnly = t.replaceAll(/[^a-záéíóúñü]/gi as any, '')
    return lettersOnly.length < this.minTextLength
  }
}
