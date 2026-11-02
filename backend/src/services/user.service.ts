import bcrypt from 'bcryptjs';
import { UserModel } from '../models';
import type { AuthUser, Role } from '../types';
import { ApiError } from '../utils/ApiError';
import { audit } from '../utils/audit';

const BCRYPT_ROUNDS = 12;

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_ROUNDS);
}

// Hash compared against when the username does not exist, so response timing does not reveal valid usernames.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= bcrypt.hash('not-a-real-password', BCRYPT_ROUNDS));

export async function verifyLogin(username: string, password: string) {
  const user = await UserModel.findOne({ username: username.trim().toLowerCase() }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash ?? (await getDummyHash()));
  if (!user || !ok) throw ApiError.unauthorized('Invalid username or password');
  if (!user.isActive) throw ApiError.unauthorized('Account is inactive');
  user.lastLoginAt = new Date();
  await user.save();
  return user;
}

export async function createUser(input: { name: string; username: string; email?: string; password: string; role: Role }, actor: AuthUser) {
  const exists = await UserModel.exists({ username: input.username.toLowerCase() });
  if (exists) throw ApiError.conflict('Username already taken', 'DUPLICATE_USERNAME');
  const user = await UserModel.create({
    name: input.name,
    username: input.username,
    email: input.email,
    role: input.role,
    passwordHash: await hashPassword(input.password),
  });
  await audit(actor, 'CREATE', 'User', user._id, user.username, `${user.name} (${user.role})`);
  return user.toJSON();
}

export async function updateUser(
  id: string,
  input: { name?: string; email?: string; role?: Role; isActive?: boolean; password?: string },
  actor: AuthUser,
) {
  const user = await UserModel.findById(id);
  if (!user) throw ApiError.notFound('User');
  if (String(user._id) === actor.id && (input.isActive === false || (input.role && input.role !== 'ADMIN'))) {
    throw ApiError.conflict('You cannot deactivate or demote your own account');
  }
  if ((input.isActive === false || (input.role && input.role !== 'ADMIN')) && user.role === 'ADMIN') {
    const admins = await UserModel.countDocuments({ role: 'ADMIN', isActive: true, _id: { $ne: user._id } });
    if (!admins) throw ApiError.conflict('At least one active admin is required');
  }
  if (input.name !== undefined) user.name = input.name;
  if (input.email !== undefined) user.email = input.email;
  if (input.role !== undefined) user.role = input.role;
  if (input.isActive !== undefined) user.isActive = input.isActive;
  if (input.password) user.passwordHash = await hashPassword(input.password);
  await user.save();
  await audit(actor, 'UPDATE', 'User', user._id, user.username, input.password ? 'Password reset' : 'User updated', {
    role: input.role,
    isActive: input.isActive,
  });
  return user.toJSON();
}

export async function changeOwnPassword(actor: AuthUser, currentPassword: string, newPassword: string) {
  const user = await UserModel.findById(actor.id).select('+passwordHash');
  if (!user) throw ApiError.notFound('User');
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) throw ApiError.validation('Current password is incorrect');
  user.passwordHash = await hashPassword(newPassword);
  await user.save();
  await audit(actor, 'UPDATE', 'User', user._id, user.username, 'Changed own password');
}
