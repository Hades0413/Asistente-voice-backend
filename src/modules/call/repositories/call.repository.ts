import { BaseRepository } from "../../../shared/repositories/BaseRepository";
import { Pool } from "pg";
import { Call } from "../../call/models/call.model";

export class CallsRepository extends BaseRepository<Call> {
  constructor(pool: Pool) {
    super(pool, "calls");
  }
}
