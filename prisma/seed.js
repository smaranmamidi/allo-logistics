const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  console.log('Clearing existing data...');
  // Delete in reverse order of relations to prevent foreign key violations
  await prisma.idempotencyRecord.deleteMany({});
  await prisma.reservation.deleteMany({});
  await prisma.inventory.deleteMany({});
  await prisma.product.deleteMany({});
  await prisma.warehouse.deleteMany({});

  console.log('Seeding warehouses...');
  const sf = await prisma.warehouse.create({
    data: {
      name: 'San Francisco Fulfillment (US-West)',
      location: 'San Francisco, CA, USA',
    },
  });

  const ny = await prisma.warehouse.create({
    data: {
      name: 'New York Logistics (US-East)',
      location: 'Brooklyn, NY, USA',
    },
  });

  const london = await prisma.warehouse.create({
    data: {
      name: 'London Gateway (UK-South)',
      location: 'London, UK',
    },
  });

  console.log('Seeding products...');
  const products = [
    {
      sku: 'AEROGLIDE-M1',
      name: 'AeroGlide Mechanical Keyboard',
      description: 'Hot-swappable tactile mechanical keyboard with custom pre-lubed switches, RGB backlighting, and solid aluminum chassis.',
      price: 189.99,
      stock: {
        [sf.id]: 15,
        [ny.id]: 8,
        [london.id]: 0,
      },
    },
    {
      sku: 'SONICWAVE-H2',
      name: 'SonicWave Noise-Cancelling Headphones',
      description: 'Premium wireless headphones featuring hybrid active noise cancellation, high-res audio drivers, and 45-hour battery life.',
      price: 299.50,
      stock: {
        [sf.id]: 25,
        [ny.id]: 12,
        [london.id]: 20,
      },
    },
    {
      sku: 'LUMINADESK-L3',
      name: 'LuminaDesk Smart RGB Lamp',
      description: 'Intelligent desk lamp with dynamic ambient RGB lighting, circadian-rhythm auto brightness, and built-in Qi wireless fast charger.',
      price: 89.00,
      stock: {
        [sf.id]: 5,
        [ny.id]: 2,
        [london.id]: 1,
      },
    },
    {
      sku: 'APEXCHARGE-C4',
      name: 'ApexCharge 140W GaN Charger',
      description: 'Ultra-compact 3-port gallium nitride fast charger, capable of charging laptops, tablets, and phones simultaneously.',
      price: 59.99,
      stock: {
        [sf.id]: 50,
        [ny.id]: 30,
        [london.id]: 40,
      },
    },
  ];

  for (const p of products) {
    const product = await prisma.product.create({
      data: {
        sku: p.sku,
        name: p.name,
        description: p.description,
        price: p.price,
      },
    });

    console.log(`Created product: ${p.name} (${p.sku})`);

    // Seed stock levels for each warehouse
    for (const [warehouseId, stockVal] of Object.entries(p.stock)) {
      await prisma.inventory.create({
        data: {
          productId: product.id,
          warehouseId: warehouseId,
          totalStock: stockVal,
          reservedStock: 0,
        },
      });
    }
  }

  console.log('Database successfully seeded!');
}

main()
  .catch((e) => {
    console.error('Error during seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
