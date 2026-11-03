import { randomUUID } from 'node:crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import { createApp } from '../src/app';
import { connectDatabase } from '../src/config/db';
import { BrandModel, ExpenseCategoryModel, ProductCategoryModel, UserModel } from '../src/models';
import { syncIndexes } from '../src/scripts/indexes';
import { seedDefaults } from '../src/scripts/seed-data';
import { invalidateSettingsCache } from '../src/services/settings.service';
import { hashPassword } from '../src/services/user.service';

export const app = createApp();
export type Tokens = Record<'admin' | 'cashier' | 'technician' | 'accountant', string>;

export async function setupDatabase(dbName: string): Promise<Tokens> {
  const uri = process.env.TEST_MONGODB_URI;
  if (!uri) throw new Error('TEST_MONGODB_URI not set (global setup failed)');
  await connectDatabase(uri, dbName);
  await mongoose.connection.dropDatabase();
  invalidateSettingsCache();
  await syncIndexes();
  await seedDefaults({ username: 'admin', password: 'Admin@12345' });
  const hash = await hashPassword('Password@123');
  await UserModel.create([
    { name: 'Cathy Cashier', username: 'cashier', role: 'CASHIER', passwordHash: hash },
    { name: 'Tom Technician', username: 'tech', role: 'TECHNICIAN', passwordHash: hash },
    { name: 'Alan Accountant', username: 'accountant', role: 'ACCOUNTANT', passwordHash: hash },
  ]);
  const login = async (username: string, password: string) => {
    const res = await request(app).post('/api/v1/auth/login').send({ username, password });
    if (res.status !== 200) throw new Error(`login failed for ${username}: ${JSON.stringify(res.body)}`);
    return res.body.data.token as string;
  };
  return {
    admin: await login('admin', 'Admin@12345'),
    cashier: await login('cashier', 'Password@123'),
    technician: await login('tech', 'Password@123'),
    accountant: await login('accountant', 'Password@123'),
  };
}

 //new thisngs 

export async function teardownDatabase() {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
}

/** Small typed API client bound to a bearer token. */
export function api(token: string) {
  const auth = (r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  return {
    get: (url: string) => auth(request(app).get(`/api/v1${url}`)),
    post: (url: string, body?: object) => auth(request(app).post(`/api/v1${url}`)).send(body ?? {}),
    patch: (url: string, body?: object) => auth(request(app).patch(`/api/v1${url}`)).send(body ?? {}),
    put: (url: string, body?: object) => auth(request(app).put(`/api/v1${url}`)).send(body ?? {}),
  };
}

export const rid = () => randomUUID();

export async function masterId(model: 'brand' | 'productCategory' | 'expenseCategory', name: string) {
  const m = model === 'brand' ? BrandModel : model === 'productCategory' ? ProductCategoryModel : ExpenseCategoryModel;
  const doc = await m.findOne({ name }).lean();
  return String(doc!._id);
}

export function expectOk(res: request.Response, status = [200, 201]) {
  if (!status.includes(res.status)) {
    throw new Error(`Expected ${status.join('/')} but got ${res.status}: ${JSON.stringify(res.body)}`);
  }
  return res.body.data;
}
