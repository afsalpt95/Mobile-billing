import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserModel } from '../models';
import { can, type Permission, type Role } from '../types';
import { ApiError } from '../utils/ApiError';

interface TokenPayload {
  sub: string;
  role: Role;
}

export function signToken(userId: string, role: Role): string {
  return jwt.sign({ sub: userId, role } satisfies TokenPayload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
  });
}

function extractToken(req: Request): string | undefined {
  const cookieToken = req.cookies?.[env.COOKIE_NAME];
  if (cookieToken) return cookieToken;
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  return undefined;
}

/** Verifies the JWT and re-loads the user so deactivation / role changes take effect immediately. */
export async function authenticate(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = extractToken(req);
    if (!token) throw ApiError.unauthorized();
    let payload: TokenPayload;
    try {
      payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    } catch {
      throw ApiError.unauthorized('Session expired or invalid. Please sign in again.');
    }
    const user = await UserModel.findById(payload.sub).lean();
    if (!user || !user.isActive) throw ApiError.unauthorized('Account is inactive');
    req.user = { id: String(user._id), name: user.name, username: user.username, role: user.role as Role };
    next();
  } catch (err) {
    next(err);
  }
}

export function requirePermission(...permissions: Permission[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(ApiError.unauthorized());
    if (!permissions.some((p) => can(req.user!.role, p))) return next(ApiError.forbidden());
    next();
  };
}
