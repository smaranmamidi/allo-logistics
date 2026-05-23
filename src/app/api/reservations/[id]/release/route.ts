import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function POST(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const reservationId = params.id;

  try {
    // 1. Fetch the reservation
    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        product: true,
        warehouse: true
      }
    });

    if (!reservation) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Reservation not found' },
        { status: 404 }
      );
    }

    // 2. Handle already released
    if (reservation.status === 'RELEASED') {
      return NextResponse.json({
        message: 'Reservation already released successfully',
        reservation
      }, { status: 200 });
    }

    // 3. Handle already confirmed
    if (reservation.status === 'CONFIRMED') {
      return NextResponse.json({
        error: 'Conflict',
        message: 'Cannot release a reservation that has already been confirmed'
      }, { status: 409 });
    }

    // 4. Release the reservation inside a database transaction
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

        // A. Set status to RELEASED
        const updated = await tx.reservation.update({
          where: { id: reservationId },
          data: { status: 'RELEASED' },
          include: {
            product: {
              select: { id: true, name: true, sku: true }
            },
            warehouse: {
              select: { id: true, name: true }
            }
          }
        });

        // B. Decrement reservedStock in Inventory by the reserved quantity
        // This makes the held units available again to other shoppers
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

        return updated;
      });
    } catch (txError) {
      if (txError instanceof Error && txError.message === 'NOT_PENDING') {
        // Fetch current status to return accurate message
        const freshRes = await prisma.reservation.findUnique({
          where: { id: reservationId }
        });
        if (freshRes?.status === 'CONFIRMED') {
          return NextResponse.json({
            error: 'Conflict',
            message: 'Cannot release a reservation that has already been confirmed'
          }, { status: 409 });
        }
        return NextResponse.json({
          message: 'Reservation already released successfully',
          reservation: freshRes
        }, { status: 200 });
      }
      throw txError;
    }

    return NextResponse.json({
      message: 'Reservation released successfully',
      reservation: updatedReservation
    }, { status: 200 });
  } catch (error) {
    console.error('[API] Error in POST /api/reservations/:id/release:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
