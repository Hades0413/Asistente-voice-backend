export class CallSummaryService {
  incremental(current: string, newText: string) {
    const next = (current ? current + ' ' : '') + newText
    return next.length > 900 ? next.slice(-900) : next
  }

  finalize(running: string) {
    return `Resumen de llamada:\n${running}`
  }
}
