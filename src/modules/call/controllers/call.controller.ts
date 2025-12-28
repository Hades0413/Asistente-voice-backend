import { BaseController } from "../../../shared/controllers/BaseController";
import { Request, Response } from "express";
import { CallsService } from "../services/application/call.service";

export class CallsController extends BaseController {
  constructor(private readonly callsService: CallsService) {
    super();
  }

  async getAll(req: Request, res: Response) {
    try {
      const calls = await this.callsService.getAllCalls();
      this.ok(res, calls);
    } catch (err: any) {
      this.serverError(res, "Failed to fetch calls", err.message);
    }
  }
}
