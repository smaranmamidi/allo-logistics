# Allo Logistics: High-Concurrency Stock Holds & Checkout Reservation Engine

Allo is an end-to-end multi-warehouse retail and D2C inventory and order-fulfillment platform. This repository implements a high-performance, concurrency-safe checkout reservation system. 

When a customer reaches checkout, payments can take several minutes (due to 3D-Secure, UPI redirects, or wallet delays). During this critical window, thousands of other shoppers might be viewing the same product. This application solves the race condition of double-allocating stock **without depleting active conversion rates** through a robust **temporal lock (checkout hold)** pattern.

---

## 🚀 Key Features

* **Concurrency-Safe Stock Allocation**: Employs transactional, row-level database locks preventing race conditions under high traffic. If exactly one unit remains, exactly one checkout request succeeds.
* **Stripe-Style Idempotency**: Implements transactional idempotency logging using an `Idempotency-Key` header, allowing safe retries under low-signal mobile connections without double-allocating stock.
* **Double-Action Expiry Mechanism**: Combines lazy cleanup-on-read with active cron sweeps to guarantee absolute inventory accuracy.
* **Multi-Warehouse Architecture**: Manages real-time stock levels across multiple fulfillment centers (San Francisco, New York, London).
* **Live Countdown Checkout**: Real-time React-based checkout visualizer complete with precise timer countdowns, payment simulation, and explicit error handlers (including `409 Conflict` and `410 Gone`).

---

## 🛠️ How to Run the App Locally

### 1. Prerequisites
Ensure you have **Node.js v18+** and **npm** installed.

### 2. Configure Environment Variables
Create a `.env` file in the root of the project (this is ignored by Git to protect secrets):

```env
# Neon Serverless PostgreSQL Database Connection String
DATABASE_URL="postgresql://neondb_owner:npg_2imvVbhCB9ou@ep-silent-silence-apsqf6yt-pooler.c-7.us-east-1.aws.neon.tech/neondb?sslmode=require&channel_binding=require"

# Upstash REST Redis Client Configuration
UPSTASH_REDIS_REST_URL="https://creative-buzzard-37363.upstash.io"
UPSTASH_REDIS_REST_TOKEN="AZHzAAIgcDFmYTgzZmIzMWVlZTI0MDdmYjYzNmNkOGQ3ZDBmOWEwNg"
```

### 3. Install Dependencies
Run the following command to install the required dependencies:
```bash
npm install
```

### 4. Database Setup & Migrations
Sync your local environment with the Neon database schema and generate the Prisma client:
```bash
npx prisma db push
```

### 5. Seed the Database
Populate your database with rich, multi-warehouse products, inventory mappings, and initial stock levels:
```bash
npx prisma db seed
```
This runs the JavaScript seed script `prisma/seed.js` and seeds the following items:
* **Warehouses**: San Francisco Fulfillment (US-West), New York Logistics (US-East), London Gateway (UK-South).
* **Products**: Mechanical Keyboards, ANC Headphones, Smart RGB Lamps, and 140W GaN Chargers, complete with multi-region stock allocations.

### 6. Run the Dev Server
Launch the Next.js local development server:
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser to interact with the application.

---

## ⚡ Concurrency & Race-Condition Safeguards

The core technical challenge is ensuring that **two concurrent checkouts for the last unit of a SKU do not both succeed**. If two shoppers submit checkouts simultaneously:
1. One shopper must successfully acquire the hold (HTTP `201 Created`).
2. The second shopper must fail gracefully (HTTP `409 Conflict`).

### Implementation:
We guarantee this at the **database engine level** by executing stock reservation within a PostgreSQL Interactive Transaction. Instead of doing a loose `SELECT` followed by an `UPDATE` (which is vulnerable to phantom reads), we run an atomic update with conditional boundaries:

```typescript
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
```

#### Why this is bulletproof under high concurrency:
1. **Row-level Locks**: PostgreSQL automatically acquires an exclusive write-lock on the matching `Inventory` row during an `UPDATE` statement.
2. **Serialization**: If two threads execute this update concurrently, PostgreSQL forces sequential execution. 
3. **Atomic Evaluation**: The first thread succeeds and updates `reservedStock`. When the second thread executes, it evaluates the row *after* the first thread committed. Since `totalStock - reservedStock >= quantity` is now false, `affectedRows` returns `0`.
4. **Rollback Integrity**: If `affectedRows` is `0`, we throw a rollback error, aborting the reservation creation and ensuring no "ghost holds" are registered.

---

## 🔑 Stripe-Style Idempotency

In unstable network environments (e.g., cell towers), a client might submit a reservation or confirm a payment, lose connection, and retry. Without idempotency, a retry would increment holds twice or deduct stock twice.

### Implementation:
We implemented the `Idempotency-Key` header on both the `/api/reservations` (Reserve Hold) and `/api/reservations/:id/confirm` (Payment Confirmation) endpoints.

1. **Transactional Deduplication**: When a request arrives with an `Idempotency-Key` header, we query the `IdempotencyRecord` table inside PostgreSQL.
2. **Cache Hit**: If the key exists and is valid (expires in 24 hours), we immediately return the cached status code and response body **without executing any side effects**.
3. **Cache Miss**: If the key is new, we proceed with the transactional logic. Upon completion (either success or business-level failure like a 409), we upsert the status and response body into the `IdempotencyRecord` table in the *same* database transaction block.
4. **Concurrent Requests**: If two identical requests with the same key arrive simultaneously, PostgreSQL's primary key constraint on `key` forces one transaction to fail and roll back, preserving absolute safety.

An interactive **Idempotency Playground** console is integrated directly into the dashboard header, allowing you to toggle key auto-rotation or enter custom keys to inspect retries in real-time.

---

## ⏱️ Hold Expiry & Automatic Release Architecture

Reservations represent locked stock. If a customer abandons their cart, we must release the units so they become available to others.

### Production Design: The Double-Action Approach

To build a zero-maintenance, highly resilient expiry worker, we implemented a **Double-Action Architecture**:

* **Lazy Cleanup-on-Read (Guarantees Correctness)**:
  Before any read or write operation on products or reservations (`GET /api/products`, `POST /api/reservations`), the system runs a fast, transaction-isolated check:
  * Finds all `Reservation` rows where `status = 'PENDING'` and `expiresAt < now()`.
  * Iterates through them, setting their status to `RELEASED` and decrementing `reservedStock` in `Inventory`.
  * **Benefit**: The client is guaranteed to see 100% correct inventory levels instantly, even if the cron job has a 1-minute latency.

* **Active Background Cron (Guarantees Cleanup)**:
  In production, a serverless Cron job (like Vercel Crons or a GitHub Action) triggers `POST /api/cron/cleanup` every 1 minute.
  * **Benefit**: Cleans up abandoned reservations even during periods of low organic site traffic, ensuring database size and locks remain optimized.

---

## 📐 Trade-offs & Future Scaling Recommendations

With more time or in a large-scale enterprise environment, we would consider the following trade-offs:

1. **Database Locking vs. Redis Distributed Locking**:
   * *Current Trade-off*: Row-level locking inside PostgreSQL (`UPDATE FOR UPDATE` equivalents) is highly robust and transactionally perfect, but keeps database connections open during transactions.
   * *Scale Recommendation*: At tens of thousands of requests per second, we should move the hot reservation state to **Redis (using Redlock or Lua scripts)**. Redis runs in-memory and can execute atomic check-and-set operations in sub-milliseconds, offloading transactional stress from PostgreSQL.
2. **Relational Database Sharding**:
   * *Current Trade-off*: Inventory is stored in a single global `Inventory` table, which is a bottleneck if all warehouses write to the same table.
   * *Scale Recommendation*: Since inventory is naturally segmented by warehouse, we can shard the database by `warehouseId`. SF inventory queries never touch London database clusters, isolating outages and increasing throughput.
3. **Queue-Based Checkout**:
   * *Current Trade-off*: The API blocks the client until the database transaction succeeds or fails.
   * *Scale Recommendation*: For high-demand flash sales, we should put incoming reservation requests into a message broker (e.g., Kafka or RabbitMQ) and process them asynchronously, returning a "Holding..." queue state to the user. This prevents web servers from exhausting thread pools during spikes.
