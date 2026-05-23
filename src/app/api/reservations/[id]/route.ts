import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { releaseExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  const reservationId = params.id;

  try {
    // Proactively run expired reservation cleanup first
    await releaseExpiredReservations();

    const reservation = await prisma.reservation.findUnique({
      where: { id: reservationId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            price: true,
            description: true,
          },
        },
        warehouse: {
          select: {
            id: true,
            name: true,
            location: true,
          },
        },
      },
    });

    if (!reservation) {
      return NextResponse.json(
        { error: 'Not Found', message: 'Reservation not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(reservation, { status: 200 });
  } catch (error) {
    console.error(`[API] Error in GET /api/reservations/${reservationId}:`, error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
