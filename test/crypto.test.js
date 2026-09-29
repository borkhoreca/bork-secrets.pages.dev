import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encryptSecret, decryptSecret } from '../src/crypto.js';

const key = Buffer.alloc(32, 1).toString('base64');
const hexKey = Buffer.alloc(32, 1).toString('hex');

test('AES-GCM round trip with base64 and hex keys, random IV per call', async () => {
  const a = await encryptSecret('hello ✓', key, 'shr_1');
  const b = await encryptSecret('hello ✓', key, 'shr_1');
  assert.notEqual(a.iv, b.iv);
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.equal(await decryptSecret(a, hexKey, 'shr_1'), 'hello ✓');
});

test('decrypt fails for a different share id or tampered ciphertext', async () => {
  const a = await encryptSecret('x', key, 'shr_1');
  await assert.rejects(decryptSecret(a, key, 'shr_2'));
  const bytes = Buffer.from(a.ciphertext, 'base64'); bytes[0] ^= 1;
  await assert.rejects(decryptSecret({ ...a, ciphertext: bytes.toString('base64') }, key, 'shr_1'));
});

test('rejects keys that are not 256 bits', async () => {
  await assert.rejects(encryptSecret('x', 'short', 'shr_1'), /256-bit/);
});
