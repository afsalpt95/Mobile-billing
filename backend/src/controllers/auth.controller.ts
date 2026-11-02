import type { Request, Response } from 'express';
import { env } from '../config/env';
import { signToken } from '../middleware/auth';
import { UserModel } from '../models';
import * as users from '../services/user.service';
import { permissionsFor, type Role } from '../types';
import { audit } from '../utils/audit';
import { ok } from '../utils/respond';

const cookieOptions = () => ({
  httpOnly: true,
  secure: env.COOKIE_SECURE,
  sameSite: 'lax' as const,
  path: '/',
  maxAge: 1000 * 60 * 60 * 24 * 7,
});

export async function login(req: Request, res: Response) {
  const user = await users.verifyLogin(req.body.username, req.body.password);
  const token = signToken(String(user._id), user.role as Role);
  res.cookie(env.COOKIE_NAME, token, cookieOptions());
  await audit({ id: String(user._id), name: user.name, username: user.username, role: user.role as Role }, 'LOGIN', 'User', user._id, user.username);
  ok(res, {
    // Token is also returned for API clients/tests; the web app relies on the httpOnly cookie only.
    token,
    user: { id: user._id, name: user.name, username: user.username, role: user.role, permissions: permissionsFor(user.role as Role) },
  });
}

export async function logout(_req: Request, res: Response) {
  res.clearCookie(env.COOKIE_NAME, { ...cookieOptions(), maxAge: undefined });
  ok(res, { loggedOut: true });
}

export async function me(req: Request, res: Response) {
  const user = await UserModel.findById(req.user!.id).lean();
  ok(res, {
    id: user!._id,
    name: user!.name,
    username: user!.username,
    email: user!.email,
    role: user!.role,
    permissions: permissionsFor(user!.role as Role),
  });
}

export async function changePassword(req: Request, res: Response) {
  await users.changeOwnPassword(req.user!, req.body.currentPassword, req.body.newPassword);
  ok(res, { changed: true });
}
