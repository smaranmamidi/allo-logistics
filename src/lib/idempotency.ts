/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from './prisma';

/**
 * Checks if a request has already been processed using the idempotency key.
 * Returns the cached response status and body if it exists and is not expired.
 */
export async function checkIdempotency(key: string): Promise<{ status: number; body: any } | null> {
  if (!key || key.trim() === '') return null;

  try {
    const record = await prisma.idempotencyRecord.findUnique({
      where: { key }
    });

    if (!record) return null;

    // Check if the record has expired
    if (record.expiresAt < new Date()) {
      // Clean up expired key asynchronously
      prisma.idempotencyRecord.delete({ where: { key } }).catch(err => {
        console.error(`[Idempotency] Failed to delete expired key ${key}:`, err);
      });
      return null;
    }

    return {
      status: record.responseStatus,
      body: JSON.parse(record.responseBody)
    };
  } catch (err) {
    console.error(`[Idempotency] Error checking key ${key}:`, err);
    return null;
  }
}

/**
 * Saves the response status and body associated with an idempotency key.
 */
export async function saveIdempotency(key: string, status: number, body: any): Promise<void> {
  if (!key || key.trim() === '') return;

  try {
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000); // 24-hour validity

    await prisma.idempotencyRecord.upsert({
      where: { key },
      update: {
        responseStatus: status,
        responseBody: JSON.stringify(body),
        expiresAt
      },
      create: {
        key,
        responseStatus: status,
        responseBody: JSON.stringify(body),
        expiresAt
      }
    });
  } catch (err) {
    console.error(`[Idempotency] Error saving key ${key}:`, err);
  }
}
