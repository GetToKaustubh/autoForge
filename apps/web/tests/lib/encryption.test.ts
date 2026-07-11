import { describe, it, expect, beforeAll } from 'vitest'
import { encrypt, decrypt } from '@/lib/utils/encryption'

beforeAll(() => {
  // Set a test encryption key (32 bytes = 64 hex chars)
  process.env.ENCRYPTION_KEY = 'a'.repeat(64)
})

describe('encryption', () => {
  it('encrypts and decrypts a string correctly', () => {
    const plaintext = 'ya29.google-oauth-token-example'
    const ciphertext = encrypt(plaintext)

    expect(ciphertext).not.toBe(plaintext)
    expect(ciphertext).toMatch(/^[A-Za-z0-9+/=]+$/) // valid base64

    const decrypted = decrypt(ciphertext)
    expect(decrypted).toBe(plaintext)
  })

  it('produces different ciphertext for same input (random IV)', () => {
    const plaintext = 'same-token'
    const cipher1 = encrypt(plaintext)
    const cipher2 = encrypt(plaintext)
    expect(cipher1).not.toBe(cipher2)
  })

  it('throws on tampered ciphertext', () => {
    const ciphertext = encrypt('original')
    const tampered = Buffer.from(ciphertext, 'base64')
    tampered[20] = tampered[20]! ^ 0xff  // flip a byte in the ciphertext
    expect(() => decrypt(tampered.toString('base64'))).toThrow()
  })
})
