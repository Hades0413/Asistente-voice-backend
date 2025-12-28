import { Response } from "express";

export abstract class BaseController {
  protected sendResponse<T>(res: Response, status: number, data: T): void {
    res.status(status).json({ data });
  }

  protected sendError(
    res: Response,
    status: number,
    message: string,
    details?: any
  ): void {
    res.status(status).json({ error: { message, details } });
  }

  protected ok<T>(res: Response, data: T): void {
    this.sendResponse(res, 200, data);
  }

  protected created<T>(res: Response, data: T): void {
    this.sendResponse(res, 201, data);
  }

  protected badRequest(res: Response, message: string, details?: any): void {
    this.sendError(res, 400, message, details);
  }

  protected unauthorized(res: Response, message: string): void {
    this.sendError(res, 401, message);
  }

  protected notFound(res: Response, message: string): void {
    this.sendError(res, 404, message);
  }

  protected serverError(res: Response, message: string, details?: any): void {
    this.sendError(res, 500, message, details);
  }
}
