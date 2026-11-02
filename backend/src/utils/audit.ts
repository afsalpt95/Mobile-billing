import type { Types } from 'mongoose';
import { AuditLogModel } from '../models';
import type { AuthUser } from '../types';
import type { Session } from './transaction';

export async function audit(
  user: AuthUser | undefined,
  action: string,
  entity: string,
  entityId: Types.ObjectId | string | undefined,
  refNo?: string,
  summary?: string,
  data?: unknown,
  session?: Session,
): Promise<void> {
  await new AuditLogModel({
    user: user?.id,
    userName: user?.name,
    action,
    entity,
    entityId,
    refNo,
    summary,
    data,
  }).save({ session });
}
