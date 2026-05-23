import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { checkIdempotency, saveIdempotency } from '@/lib/idempotency';

export const dynamic = 'force-dynamic';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const reservationId = params.id;
  const idempotencyKey = req.headers.get('idempotency-key') || req.headers.get('Idempotency-Key');

  // 1. Check idempotency first if key is provided
  if (idempotencyKey) {
    const cachedResponse = await checkIdempotency(idempotencyKey);
    if (cachedResponse) {
      console.log(`[Idempotency] Cache hit for confirm reservation: ${idempotencyKey}`);
      return NextResponse.json(cachedResponse.body, { status: cachedResponse.status });
    }
  }

  try {
    // 2. Fetch the reservation
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        product: true,
        warehouse: true
      }
    });

    if (!reservation) {
      const responseBody = { error: 'Not Found', message: 'Reservation not found' };
      if (idempotencyKey) {
        await saveIdempotency(idempotencyKey, 404, responseBody);
      }
      return NextResponse.json(responseBody, { status: 404 });
    }

    // 3. Handle already confirmed status
    if (reservation.status === 'CONFIRMED') {
      const responseBody = {
        message: 'Reservation already confirmed successfully',
        reservation
      };
      if (idempotencyKey) {
        await saveIdempotency(idempotencyKey, 200, responseBody);
      }
      return NextResponse.json(responseBody, { status: 200 });
    }

    // 4. Handle expired or already released reservation
    const isExpired = reservation.expiresAt < new Date();
    if (reservation.status === 'RELEASED' || isExpired) {
      // If it is pending but expired, we should lazily release it now
      if (reservation.status === 'PENDING' && isExpired) {
        try {
          await prisma.$transaction(async (tx) => {
            // Mark as RELEASED
            await tx.reservation.update({
              where: { id: reservationId },
              data: { status: 'RELEASED' }
            });

            // Decrement reservedStock in Inventory
            await tx.inventory.update({
              where: {
                productId_warehouseId: {
                  productId: reservation.productId,
                  warehouseId: reservation.warehouseId
                }
              },
              data: {
                reservedStock: {
                  decrement: reservation.quantity
                }
              }
            });
          }, { timeout: 15000 });
        } catch (err) {
          console.error(`[Confirm] Error doing lazy cleanup of expired reservation ${reservationId}:`, err);
        }
      }

      const responseBody = {
        error: 'Gone',
        message: 'Reservation has expired and the held units have been returned to available stock'
      };
      if (idempotencyKey) {
        await saveIdempotency(idempotencyKey, 410, responseBody);
      }
      return NextResponse.json(responseBody, { status: 410 });
    }

    // 5. Confirm reservation in a transaction
    let updatedReservation;
    try {
      updatedReservation = await prisma.$transaction(async (tx) => {
        // Double check status again inside transaction to prevent concurrent race
        const currentRes = await tx.reservation.findUnique({
          where: { id: reservationId }
        });

        if (!currentRes || currentRes.status !== 'PENDING') {
          throw new Error('NOT_PENDING');
        }

        if (currentRes.expiresAt < new Date()) {
          throw new Error('EXPIRED');
        }

        // A. Set status to CONFIRMED
        const updated = await tx.reservation.update({
          where: { id: reservationId },
          data: { status: 'CONFIRMED' },
          include: {
            product: {
              select: { id: true, name: true, sku: true, price: true }
            },
            warehouse: {
              select: { id: true, name: true }
            }
          }
        });

        // B. Decrement both totalStock and reservedStock in Inventory by the reserved quantity
        // This permanently subtracts the physical units from total inventory and releases the hold
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: reservation.productId,
              warehouseId: reservation.warehouseId
            }
          },
          data: {
            totalStock: { decrement: reservation.quantity },
            reservedStock: { decrement: reservation.quantity }
          }
        });

        return updated;
      }, { timeout: 15000 });
    } catch (txError) {
      if (txError instanceof Error && txError.message === 'NOT_PENDING') {
        const responseBody = { error: 'Conflict', message: 'Reservation has already been processed' };
        if (idempotencyKey) {
          await saveIdempotency(idempotencyKey, 409, responseBody);
        }
        return NextResponse.json(responseBody, { status: 409 });
      }

      if (txError instanceof Error && txError.message === 'EXPIRED') {
        const responseBody = { error: 'Gone', message: 'Reservation expired during confirmation' };
        if (idempotencyKey) {
          await saveIdempotency(idempotencyKey, 410, responseBody);
        }
        return NextResponse.json(responseBody, { status: 410 });
      }
      throw txError;
    }

    // 6. Save and return successful response
    const finalResponse = {
      message: 'Reservation confirmed successfully',
      reservation: updatedReservation
    };
    
    if (idempotencyKey) {
      await saveIdempotency(idempotencyKey, 200, finalResponse);
    }

    return NextResponse.json(finalResponse, { status: 200 });
  } catch (error) {
    console.error('[API] Error in POST /api/reservations/:id/confirm:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
