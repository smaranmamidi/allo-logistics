'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Package, 
  Warehouse as WarehouseIcon, 
  ArrowRight, 
  Lock, 
  RefreshCw, 
  CheckCircle, 
  AlertTriangle, 
  Layers, 
  Cpu, 
  Activity
} from 'lucide-react';

interface Warehouse {
  id: string;
  name: string;
  location: string | null;
}

interface Inventory {
  id: string;
  warehouseId: string;
  warehouse: Warehouse;
  totalStock: number;
  reservedStock: number;
  availableStock: number;
}

interface Product {
  id: string;
  sku: string;
  name: string;
  description: string | null;
  price: number;
  inventories: Inventory[];
}

export default function ProductListingPage() {
  const router = useRouter();
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Idempotency settings for demo purposes
  const [customIdempotencyKey, setCustomIdempotencyKey] = useState('');
  const [autoGenKey, setAutoGenKey] = useState(true);
  
  // Reserving state per warehouseId-productId key
  const [reservingKey, setReservingKey] = useState<string | null>(null);
  const [apiError, setApiError] = useState<{ message: string; code: number } | null>(null);

  // Generate a new idempotency key
  const generateNewKey = () => {
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    setCustomIdempotencyKey(`IDEM-RES-${randomSuffix}`);
  };

  const fetchProducts = async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch('/api/products');
      if (!res.ok) {
        throw new Error(`Failed to fetch products: ${res.statusText}`);
      }
      const data = await res.json();
      setProducts(data);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An unexpected error occurred');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProducts();
    generateNewKey();
  }, []);

  // Update idempotency key auto-generation if enabled
  useEffect(() => {
    if (autoGenKey && !reservingKey) {
      generateNewKey();
    }
  }, [autoGenKey, reservingKey]);

  const handleReserve = async (productId: string, warehouseId: string, availableStock: number) => {
    if (availableStock <= 0) return;

    const actionKey = `${productId}-${warehouseId}`;
    setReservingKey(actionKey);
    setApiError(null);

    // Use current custom key or generate a fresh one
    const idKey = customIdempotencyKey.trim() || `IDEM-RES-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    try {
      const res = await fetch('/api/reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idKey,
        },
        body: JSON.stringify({
          productId,
          warehouseId,
          quantity: 1,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setApiError({
          message: data.message || data.error || 'Failed to complete reservation',
          code: res.status,
        });
        
        // Refresh products list to show latest concurrent stock levels
        fetchProducts();
        
        // If it was a 409 conflict, let's keep it visible.
        return;
      }

      // If successful, navigate to the checkout page with the reservation ID
      router.push(`/checkout/${data.id}`);
    } catch (err) {
      console.error(err);
      setApiError({
        message: err instanceof Error ? err.message : 'Network error. Please try again.',
        code: 500,
      });
    } finally {
      setReservingKey(null);
    }
  };

  // Helper to get global stats
  const totalSkuCount = products.length;
  const totalStockCount = products.reduce((acc, p) => 
    acc + p.inventories.reduce((sum, inv) => sum + inv.totalStock, 0), 0
  );
  const totalReservedCount = products.reduce((acc, p) => 
    acc + p.inventories.reduce((sum, inv) => sum + inv.reservedStock, 0), 0
  );
  const netAvailableStock = totalStockCount - totalReservedCount;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans selection:bg-indigo-500 selection:text-white pb-16">
      {/* Decorative gradient overlay */}
      <div className="absolute top-0 left-0 right-0 h-[400px] bg-gradient-to-b from-indigo-500/10 via-purple-500/5 to-transparent pointer-events-none" />

      {/* Header */}
      <header className="relative border-b border-zinc-800/80 bg-zinc-900/40 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="bg-indigo-600 p-2 rounded-xl text-white shadow-md shadow-indigo-600/20 flex items-center justify-center">
              <Layers className="h-5 w-5 animate-pulse" />
            </div>
            <div>
              <span className="font-extrabold text-lg tracking-wider bg-gradient-to-r from-white via-zinc-200 to-zinc-400 bg-clip-text text-transparent">ALLO</span>
              <span className="text-zinc-500 text-xs ml-1.5 uppercase tracking-widest font-semibold border-l border-zinc-700 pl-2">Ops Desk</span>
            </div>
          </div>
          
          <div className="flex items-center space-x-4">
            <button 
              onClick={fetchProducts}
              disabled={loading}
              className="flex items-center space-x-1.5 px-3.5 py-1.5 rounded-lg border border-zinc-800 bg-zinc-900/60 hover:bg-zinc-800/80 text-zinc-300 hover:text-white transition-all text-sm font-medium focus:ring-2 focus:ring-indigo-500/40 disabled:opacity-50"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              <span>Sync Live Levels</span>
            </button>
            
            <a 
              href="https://github.com" 
              target="_blank" 
              rel="noreferrer"
              className="text-zinc-400 hover:text-white text-xs border border-zinc-800 px-3 py-1.5 rounded-lg bg-zinc-900/20 hover:bg-zinc-900/60 transition-all font-mono"
            >
              v1.0.0
            </a>
          </div>
        </div>
      </header>

      <main className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-10">
        {/* Title Section */}
        <div className="mb-8">
          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-semibold tracking-wider uppercase mb-1">
            <Cpu className="h-3.5 w-3.5" />
            <span>High-Concurrency Inventory Core</span>
          </div>
          <h1 className="text-3.5xl font-black tracking-tight text-white sm:text-4xl">
            Real-Time Stock Holds &amp; Reservations
          </h1>
          <p className="mt-2 text-zinc-400 max-w-3xl text-sm sm:text-base">
            Simulate a high-traffic e-commerce checkout. Lock stock instantly with safe transactional database queries. Prevent double-allocation race conditions under concurrency.
          </p>
        </div>

        {/* Global Stock Stats Dashboard */}
        <section className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          {[
            { label: 'Monitored SKUs', val: loading && products.length === 0 ? '...' : totalSkuCount, icon: Package, color: 'text-indigo-400', bg: 'from-indigo-500/10' },
            { label: 'Total Physical Stock', val: loading && products.length === 0 ? '...' : totalStockCount, icon: WarehouseIcon, color: 'text-blue-400', bg: 'from-blue-500/10' },
            { label: 'Active Holds (Reserved)', val: loading && products.length === 0 ? '...' : totalReservedCount, icon: Lock, color: 'text-amber-400', bg: 'from-amber-500/10' },
            { label: 'Available Stock', val: loading && products.length === 0 ? '...' : netAvailableStock, icon: Activity, color: 'text-emerald-400', bg: 'from-emerald-500/10' }
          ].map((stat, i) => (
            <div key={i} className="bg-zinc-900/60 border border-zinc-800/80 p-4 rounded-xl flex items-center space-x-4 relative overflow-hidden group">
              <div className={`absolute top-0 right-0 w-24 h-24 bg-gradient-to-bl ${stat.bg} to-transparent opacity-30 blur-xl group-hover:opacity-50 transition-all`} />
              <div className="bg-zinc-950 p-2.5 rounded-lg border border-zinc-800/40">
                <stat.icon className={`h-5 w-5 ${stat.color}`} />
              </div>
              <div>
                <p className="text-zinc-500 text-xs font-semibold uppercase tracking-wider">{stat.label}</p>
                <p className="text-xl sm:text-2xl font-black mt-0.5 text-white tracking-tight">{stat.val}</p>
              </div>
            </div>
          ))}
        </section>

        {/* Idempotency Playground Console */}
        <section className="bg-zinc-900/80 border border-zinc-800/80 rounded-2xl p-5 mb-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 p-3 flex items-center space-x-1.5 text-zinc-600 text-xs font-mono">
            <CheckCircle className="h-3 w-3 text-indigo-500/60" />
            <span>Idempotency-Engine Active</span>
          </div>

          <div className="flex items-center space-x-2 text-indigo-400 text-xs font-bold uppercase tracking-wider mb-2">
            <div className="h-1.5 w-1.5 rounded-full bg-indigo-500 animate-ping" />
            <span>Simulate Retries &amp; Idempotency Keys</span>
          </div>
          
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center space-x-2">
            <span>Idempotency Playground</span>
          </h2>
          <p className="text-xs text-zinc-400 mt-1 max-w-3xl">
            Clients send an <code className="text-indigo-300 font-mono">Idempotency-Key</code> header to safely retry requests without double-allocating units. Toggle auto-generation to simulate network failure retries.
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-4 items-end">
            <div className="md:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-zinc-500 mb-1.5">
                Current Reservation Idempotency Key
              </label>
              <div className="flex space-x-2">
                <div className="relative flex-grow">
                  <input
                    type="text"
                    value={customIdempotencyKey}
                    onChange={(e) => {
                      setCustomIdempotencyKey(e.target.value);
                      setAutoGenKey(false);
                    }}
                    placeholder="Enter Custom Idempotency Key"
                    className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-4 py-2.5 text-sm font-mono text-indigo-300 focus:outline-none focus:ring-1 focus:ring-indigo-500 transition-all"
                  />
                </div>
                <button
                  type="button"
                  onClick={generateNewKey}
                  className="px-3.5 py-2.5 bg-zinc-800/80 hover:bg-zinc-700/80 text-zinc-200 border border-zinc-700/60 rounded-xl text-sm font-medium transition-all flex items-center justify-center space-x-1"
                  title="Generate New Random Key"
                >
                  <RefreshCw className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex items-center space-x-3 bg-zinc-950/40 border border-zinc-800/50 rounded-xl p-3.5 h-[46px] justify-between">
              <span className="text-xs font-medium text-zinc-400">Auto-rotate key on success</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={autoGenKey} 
                  onChange={(e) => setAutoGenKey(e.target.checked)} 
                  className="sr-only peer" 
                />
                <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-zinc-400 after:border-zinc-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-600 peer-checked:after:bg-white"></div>
              </label>
            </div>
          </div>
        </section>

        {/* Global Error Banner */}
        {apiError && (
          <div className="mb-8 bg-rose-500/10 border border-rose-500/30 text-rose-200 p-4.5 rounded-xl flex items-start space-x-3.5 relative overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="absolute top-0 left-0 bottom-0 w-1 bg-rose-500" />
            <div className="bg-rose-500/20 p-2 rounded-lg text-rose-400 mt-0.5">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-grow">
              <div className="flex items-center space-x-2">
                <span className="font-bold text-sm text-white">HTTP {apiError.code} Error Detected</span>
                <span className="bg-rose-500/20 text-rose-300 text-xxs uppercase tracking-wider font-extrabold px-1.5 py-0.5 rounded font-mono">
                  {apiError.code === 409 ? 'Race Condition Blocked' : 'Action Failed'}
                </span>
              </div>
              <p className="text-xs text-rose-200/80 mt-1">{apiError.message}</p>
              {apiError.code === 409 && (
                <p className="text-xxs text-rose-300/60 mt-1.5 font-mono">
                  INFO: Exactly one shopper succeeded! The transaction safely aborted the other&apos;s request. Try requesting a new key, or select another warehouse.
                </p>
              )}
            </div>
            <button 
              onClick={() => setApiError(null)}
              className="text-rose-400 hover:text-white text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 px-2.5 py-1 rounded-lg transition-all"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Products Grid */}
        {loading && products.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 bg-zinc-900/30 border border-zinc-900 rounded-2xl">
            <RefreshCw className="h-10 w-10 text-indigo-500 animate-spin" />
            <p className="mt-4 text-zinc-400 text-sm font-medium">Querying products and stock regions...</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 bg-rose-950/20 border border-rose-900/40 rounded-2xl text-center px-4">
            <AlertTriangle className="h-12 w-12 text-rose-500 mb-3" />
            <h3 className="text-lg font-bold text-white">Failed to connect to stock database</h3>
            <p className="mt-1 text-zinc-400 text-sm max-w-md">{error}</p>
            <button 
              onClick={fetchProducts}
              className="mt-5 px-4 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm font-semibold hover:bg-zinc-700 transition-all text-white"
            >
              Retry Connection
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {products.map((product) => (
              <div 
                key={product.id}
                className="bg-zinc-900/40 border border-zinc-850 hover:border-zinc-800/80 rounded-2xl p-6 transition-all hover:shadow-xl hover:shadow-indigo-500/[0.02] flex flex-col justify-between group"
              >
                <div>
                  {/* Product Header */}
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-xxs font-mono font-bold tracking-widest text-indigo-400 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full uppercase">
                        SKU: {product.sku}
                      </span>
                      <h3 className="text-xl font-extrabold text-white mt-2 group-hover:text-indigo-300 transition-colors tracking-tight">
                        {product.name}
                      </h3>
                    </div>
                    <div className="text-right">
                      <span className="text-2xl font-black text-white tracking-tight">
                        ${product.price.toFixed(2)}
                      </span>
                      <p className="text-zinc-500 text-xxs font-semibold uppercase tracking-wider mt-0.5">Retail Price</p>
                    </div>
                  </div>

                  <p className="text-zinc-400 text-xs leading-relaxed mt-3.5 border-b border-zinc-800/60 pb-4 font-normal">
                    {product.description || 'No description provided.'}
                  </p>

                  {/* Stock Levels by Warehouse */}
                  <div className="mt-5">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-zinc-500 flex items-center space-x-1.5 mb-3.5">
                      <WarehouseIcon className="h-3.5 w-3.5 text-zinc-500" />
                      <span>Stock Allocation per Warehouse</span>
                    </h4>
                    
                    <div className="space-y-3.5">
                      {product.inventories.map((inv) => {
                        const isReserving = reservingKey === `${product.id}-${inv.warehouseId}`;
                        const isOutOfStock = inv.availableStock <= 0;

                        return (
                          <div 
                            key={inv.id}
                            className={`p-3.5 rounded-xl border transition-all flex flex-col md:flex-row md:items-center justify-between ${
                              isOutOfStock 
                                ? 'bg-zinc-950/30 border-zinc-900/60 opacity-60' 
                                : 'bg-zinc-950/60 border-zinc-850 hover:border-zinc-800'
                            }`}
                          >
                            <div className="flex-grow pr-4">
                              <div className="flex items-center space-x-1.5">
                                <span className="font-bold text-xs text-white tracking-tight">{inv.warehouse.name}</span>
                                {inv.warehouse.location && (
                                  <span className="text-xxs text-zinc-500 font-medium">({inv.warehouse.location})</span>
                                )}
                              </div>

                              {/* Progress bar showing reserved vs total stock */}
                              <div className="mt-2.5">
                                <div className="w-full bg-zinc-900 rounded-full h-1.5 overflow-hidden flex">
                                  {inv.totalStock > 0 ? (
                                    <>
                                      <div 
                                        className="bg-emerald-500 h-full transition-all duration-500" 
                                        style={{ width: `${(inv.availableStock / inv.totalStock) * 100}%` }}
                                        title={`${inv.availableStock} Available`}
                                      />
                                      <div 
                                        className="bg-amber-500 h-full transition-all duration-500" 
                                        style={{ width: `${(inv.reservedStock / inv.totalStock) * 100}%` }}
                                        title={`${inv.reservedStock} Held`}
                                      />
                                    </>
                                  ) : (
                                    <div className="bg-zinc-800 w-full h-full" />
                                  )}
                                </div>
                              </div>

                              <div className="flex space-x-3.5 mt-2.5 text-xxs font-semibold uppercase tracking-wider">
                                <span className="text-emerald-400 flex items-center space-x-1">
                                  <span className="h-1 w-1 rounded-full bg-emerald-400" />
                                  <span>{inv.availableStock} Available</span>
                                </span>
                                
                                <span className="text-amber-400 flex items-center space-x-1">
                                  <span className="h-1 w-1 rounded-full bg-amber-400" />
                                  <span>{inv.reservedStock} Held</span>
                                </span>

                                <span className="text-zinc-500">
                                  Total: {inv.totalStock}
                                </span>
                              </div>
                            </div>

                            <div className="mt-4 md:mt-0 flex-shrink-0">
                              <button
                                onClick={() => handleReserve(product.id, inv.warehouseId, inv.availableStock)}
                                disabled={isOutOfStock || isReserving}
                                className={`w-full md:w-auto px-4 py-2 rounded-xl text-xs font-bold transition-all flex items-center justify-center space-x-2 ${
                                  isOutOfStock
                                    ? 'bg-zinc-900 border border-zinc-800 text-zinc-600 cursor-not-allowed'
                                    : 'bg-indigo-600 hover:bg-indigo-500 text-white hover:shadow-lg hover:shadow-indigo-600/25 active:scale-95 cursor-pointer'
                                }`}
                              >
                                {isReserving ? (
                                  <>
                                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                                    <span>Holding...</span>
                                  </>
                                ) : isOutOfStock ? (
                                  <span>Out of Stock</span>
                                ) : (
                                  <>
                                    <span>Reserve Unit</span>
                                    <ArrowRight className="h-3.5 w-3.5 text-white/80 group-hover:translate-x-0.5 transition-transform" />
                                  </>
                                )}
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
