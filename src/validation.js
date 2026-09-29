import { HttpError } from './response.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_SECRET_BYTES = 64 * 1024;
export const MAX_BODY_BYTES = 256 * 1024;

export function intVar(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export function ttlConfig(env) {
  return {
    min: intVar(env.MIN_TTL_SECONDS, 300),
    def: intVar(env.DEFAULT_TTL_SECONDS, 604800),
    max: intVar(env.MAX_TTL_SECONDS, 1209600),
  };
}

export function clampTtl(value, env) {
  const { min, def, max } = ttlConfig(env);
  const n = Number(value);
  if (value === undefined || value === null || value === '' || !Number.isFinite(n)) return Math.min(Math.max(def, min), max);
  return Math.min(Math.max(Math.floor(n), min), max);
}

function fail(message) {
  throw new HttpError(400, 'VALIDATION_FAILED', message);
}

function optionalString(value, field, max) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') fail(`${field} must be a string`);
  if (value.length > max) fail(`${field} must be at most ${max} characters`);
  return value;
}

export function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254 && EMAIL_RE.test(value);
}

export function validateCreateRequest(body, env) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail('Request body must be a JSON object');

  const { secretValue } = body;
  if (typeof secretValue !== 'string' || secretValue.length === 0) fail('secretValue is required');
  if (new TextEncoder().encode(secretValue).length > MAX_SECRET_BYTES) fail('secretValue must be at most 64 KiB');

  const secretName = body.secretName;
  if (typeof secretName !== 'string' || secretName.trim() === '') fail('secretName is required');
  if (secretName.length > 180) fail('secretName must be at most 180 characters');

  const recipientEmail = typeof body.recipientEmail === 'string' ? body.recipientEmail.trim() : '';
  if (!isValidEmail(recipientEmail)) fail('recipientEmail must be a valid email address');

  const senderIn = body.sender ?? {};
  if (typeof senderIn !== 'object' || Array.isArray(senderIn)) fail('sender must be an object');
  const sender = {
    id: optionalString(senderIn.id, 'sender.id', 240),
    name: optionalString(senderIn.name, 'sender.name', 240),
    email: optionalString(senderIn.email, 'sender.email', 240),
    role: optionalString(senderIn.role, 'sender.role', 240),
  };
  if (sender.email && !isValidEmail(sender.email)) fail('sender.email must be a valid email address');

  return {
    secretValue,
    secretName,
    recipientEmail,
    customerId: optionalString(body.customerId, 'customerId', 240),
    customerName: optionalString(body.customerName, 'customerName', 240),
    message: optionalString(body.message, 'message', 1000),
    ttlSeconds: clampTtl(body.ttlSeconds, env),
    sender,
    sourceApp: optionalString(body.sourceApp, 'sourceApp', 240) ?? 'support-hub',
  };
}

export function maskEmail(email) {
  const at = email.lastIndexOf('@');
  if (at < 1) return '***';
  return `${email[0]}***${email.slice(at)}`;
}
