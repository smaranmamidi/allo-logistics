import prisma from './prisma';

/**
 * Releases all expired PENDING reservations and decrements their reservedStock from Inventory.
 * Can be run lazily before reads/writes, or via a cron worker.
 */
export async function releaseExpiredReservations(): Promise<number> {
  const now = new Date();
  
  // Find all expired pending reservations
  const expiredReservations = await prisma.reservation.findMany({
    where: {
      status: 'PENDING',
      expiresAt: { lt: now }
    }
  });

  if (expiredReservations.length === 0) {
    return 0;
  }

  let releasedCount = 0;

  for (const res of expiredReservations) {
    try {
      await prisma.$transaction(async (tx) => {
        // Fetch current status inside the transaction to lock the record
        // and ensure we don't double-release or override a concurrent confirmation.
        const currentRes = await tx.reservation.findUnique({
          where: { id: res.id }
        });

        if (!currentRes || currentRes.status !== 'PENDING') {
          return; // Already confirmed or released by another request
        }

        // 1. Mark the reservation as RELEASED
        await tx.reservation.update({
          where: { id: res.id },
          data: { status: 'RELEASED' }
        });

        // 2. Decrement the reserved stock in the Inventory
        // Using a decrement query ensures concurrency safety
        await tx.inventory.update({
          where: {
            productId_warehouseId: {
              productId: res.productId,
              warehouseId: res.warehouseId
            }
          },
          data: {
            reservedStock: {
              decrement: res.quantity
            }
          }
        });

        releasedCount++;
      });
    } catch (err) {
      console.error(`[Cleanup] Failed to release expired reservation ${res.id}:`, err);
    }
  }

  if (releasedCount > 0) {
    console.log(`[Cleanup] Released ${releasedCount} expired reservations.`);
  }

  return releasedCount;
}
