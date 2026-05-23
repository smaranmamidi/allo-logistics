import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import prisma from '@/lib/prisma';
import { checkIdempotency, saveIdempotency } from '@/lib/idempotency';
import { releaseExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

const reserveSchema = z.object({
  productId: z.string(),
  warehouseId: z.string(),
  quantity: z.number().int().positive().default(1),
});

export async function POST(req: NextRequest) {
  // Get the idempotency key from headers
  const idempotencyKey = req.headers.get('idempotency-key') || req.headers.get('Idempotency-Key');

  // 1. If idempotency key is present, check if we have a cached response
  if (idempotencyKey) {
    const cachedResponse = await checkIdempotency(idempotencyKey);
    if (cachedResponse) {
      console.log(`[Idempotency] Cache hit for key: ${idempotencyKey}`);
      return NextResponse.json(cachedResponse.body, { status: cachedResponse.status });
    }
  }

  try {
    // Proactively run expired reservation cleanup
    await releaseExpiredReservations();

    // 2. Validate request body
    const bodyJson = await req.json().catch(() => ({}));
    const parseResult = reserveSchema.safeParse(bodyJson);
    if (!parseResult.success) {
      const responseBody = { error: 'Bad Request', details: parseResult.error.flatten().fieldErrors };
      if (idempotencyKey) {
        await saveIdempotency(idempotencyKey, 400, responseBody);
      }
      return NextResponse.json(responseBody, { status: 400 });
    }

    const { productId, warehouseId, quantity } = parseResult.data;

    // Check if the Inventory record even exists
    const inventory = await prisma.inventory.findUnique({
      where: {
        productId_warehouseId: { productId, warehouseId },
      },
    });

    if (!inventory) {
      const responseBody = { error: 'Product is not stocked in this warehouse' };
      if (idempotencyKey) {
        await saveIdempotency(idempotencyKey, 404, responseBody);
      }
      return NextResponse.json(responseBody, { status: 404 });
    }

    // 3. Perform reservation in a database transaction with concurrency safeguards
    const expiresAt = new Date(Date.now() + 2 * 60 * 1000); // 2 minutes from now (for fast verification)

    let reservation;
    try {
      reservation = await prisma.$transaction(async (tx) => {
        // Run atomic UPDATE to increment reservedStock only if available stock (totalStock - reservedStock) is sufficient.
        // Postgres locks the row during the UPDATE, preventing race conditions between concurrent requests.
        const affectedRows = await tx.$executeRaw`
          UPDATE "Inventory"
          SET "reservedStock" = "reservedStock" + ${quantity}
          WHERE "productId" = ${productId} 
            AND "warehouseId" = ${warehouseId} 
            AND "totalStock" - "reservedStock" >= ${quantity}
        `;

        if (affectedRows === 0) {
          throw new Error('INSUFFICIENT_STOCK');
        }

        // Create the reservation record
        const res = await tx.reservation.create({
          data: {
            productId,
            warehouseId,
            quantity,
            expiresAt,
            status: 'PENDING',
          },
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                price: true,
              },
            },
            warehouse: {
              select: {
                id: true,
                name: true,
              },
            },
          },
        });

        return res;
      }, { timeout: 15000 });
    } catch (txError) {
      if (txError instanceof Error && txError.message === 'INSUFFICIENT_STOCK') {
        const responseBody = { error: 'Conflict', message: 'Not enough stock available in this warehouse' };
        if (idempotencyKey) {
          await saveIdempotency(idempotencyKey, 409, responseBody);
        }
        return NextResponse.json(responseBody, { status: 409 });
      }
      throw txError;
    }

    // 4. Save and return successful response
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, 201, reservation);
    }

    return NextResponse.json(reservation, { status: 201 });
  } catch (error) {
    console.error('[API] Error in POST /api/reservations:', error);
    const responseBody = { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) };
    return NextResponse.json(responseBody, { status: 500 });
  }
}
