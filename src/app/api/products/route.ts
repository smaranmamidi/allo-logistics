import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { releaseExpiredReservations } from '@/lib/cleanup';

// Ensure this route is dynamic so it gets fresh data from the DB
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // 1. Run lazy cleanup of expired reservations so users see accurate available stock
    await releaseExpiredReservations();

    // 2. Fetch all products with their multi-warehouse stock levels
    const products = await prisma.product.findMany({
      include: {
        inventories: {
          include: {
            warehouse: true,
          },
          orderBy: {
            warehouse: {
              name: 'asc',
            },
          },
        },
      },
      orderBy: {
        name: 'asc',
      },
    });

    // 3. Map inventory to calculate 'availableStock' dynamically
    const formattedProducts = products.map((product) => {
      const inventories = product.inventories.map((inv) => ({
        id: inv.id,
        warehouseId: inv.warehouseId,
        warehouse: {
          id: inv.warehouse.id,
          name: inv.warehouse.name,
          location: inv.warehouse.location,
        },
        totalStock: inv.totalStock,
        reservedStock: inv.reservedStock,
        availableStock: Math.max(0, inv.totalStock - inv.reservedStock),
      }));

      return {
        id: product.id,
        sku: product.sku,
        name: product.name,
        description: product.description,
        price: product.price,
        inventories,
      };
    });

    return NextResponse.json(formattedProducts, { status: 200 });
  } catch (error) {
    console.error('[API] Error in GET /api/products:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
