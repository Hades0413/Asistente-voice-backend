import { Request, Response } from 'express'
import type { StreamingService } from '../services/application/streaming.service'

export class StreamingController {
  constructor(private readonly getService: () => StreamingService) {}

  // POST /api/streaming/start-call
  // body: { phoneNumber: string, agentId?: string }
  startCall = async (req: Request, res: Response) => {
    try {
      const service = this.getService()
      const { phoneNumber, agentId } = (req.body ?? {}) as {
        phoneNumber?: string
        agentId?: string
      }

      if (!phoneNumber || typeof phoneNumber !== 'string') {
        return res.status(400).json({ error: 'phoneNumber is required' })
      }

      //Aquí asumo que tu startCall recibe objeto (como lo venías planteando).
      // Si tu startCall recibe solo string, me dices y lo ajusto.
      const out = await service.startCall({
        phoneNumber,
        agentId,
      } as any)

      return res.status(200).json(out)
    } catch (err: any) {
      return res
        .status(500)
        .json({ error: 'STREAMING_START_CALL_ERROR', detail: String(err?.message ?? err) })
    }
  }

  endCall = async (req: Request, res: Response) => {
    try {
      const service = this.getService()
      const { sessionId } = (req.body ?? {}) as { sessionId?: string }

      if (!sessionId || typeof sessionId !== 'string') {
        return res.status(400).json({ error: 'sessionId is required' })
      }

      //FIX: tu service espera string, no objeto
      const out = await service.endCall(sessionId)

      return res.status(200).json(out)
    } catch (err: any) {
      return res
        .status(500)
        .json({ error: 'STREAMING_END_CALL_ERROR', detail: String(err?.message ?? err) })
    }
  }
}
