'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { 
  Lock, 
  Clock, 
  CheckCircle, 
  XCircle, 
  ArrowLeft, 
  CreditCard, 
  Warehouse as WarehouseIcon, 
  AlertCircle, 
  FileText,
  HelpCircle,
  RefreshCw,
  ShoppingBag
} from 'lucide-react';

interface Product {
  id: string;
  name: string;
  sku: string;
  price: number;
  description: string | null;
}

interface Warehouse {
  id: string;
  name: string;
  location: string | null;
}

interface Reservation {
  id: string;
  productId: string;
  warehouseId: string;
  quantity: number;
  status: 'PENDING' | 'CONFIRMED' | 'RELEASED';
  expiresAt: string;
  createdAt: string;
  product: Product;
  warehouse: Warehouse;
}

export default function CheckoutPage({ params }: { params: { id: string } }) {
  const router = useRouter();
  const reservationId = params.id;

  const [reservation, setReservation] = useState<Reservation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  
  // Timer state
  const [timeLeft, setTimeLeft] = useState<number>(0); // in seconds
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  // Operation states
  const [confirming, setConfirming] = useState(false);
  const [releasing, setReleasing] = useState(false);
  const [apiError, setApiError] = useState<{ message: string; code: number } | null>(null);
  
  // Idempotency settings for payment simulation
  const [idempotencyKey, setIdempotencyKey] = useState('');

  // Fetch reservation details
  const fetchReservation = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = await fetch(`/api/reservations/${reservationId}`);
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('This checkout reservation does not exist.');
        }
        throw new Error(`Failed to load reservation: ${res.statusText}`);
      }
      const data: Reservation = await res.json();
      setReservation(data);
      
      // Calculate remaining time
      if (data.status === 'PENDING') {
        const expiryTime = new Date(data.expiresAt).getTime();
        const difference = Math.floor((expiryTime - Date.now()) / 1000);
        setTimeLeft(Math.max(0, difference));
      }
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : 'An error occurred while loading checkout.');
    } finally {
      setLoading(false);
    }
  }, [reservationId]);

  useEffect(() => {
    fetchReservation();
    
    // Create custom idempotency key for confirmation
    const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
    setIdempotencyKey(`IDEM-CONF-${randomSuffix}`);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [reservationId, fetchReservation]);

  // Live Countdown Timer
  useEffect(() => {
    if (reservation?.status !== 'PENDING') {
      if (timerRef.current) clearInterval(timerRef.current);
      return;
    }

    if (timeLeft <= 0) {
      if (timerRef.current) clearInterval(timerRef.current);
      // Auto-trigger release or set status as released locally if timer hits 0
      if (reservation.status === 'PENDING') {
        setReservation(prev => prev ? { ...prev, status: 'RELEASED' } : null);
      }
      return;
    }

    timerRef.current = setInterval(() => {
      setTimeLeft(prev => {
        if (prev <= 1) {
          clearInterval(timerRef.current!);
          setReservation(res => res ? { ...res, status: 'RELEASED' } : null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [timeLeft, reservation?.status]);

  // Format time (MM:SS)
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Confirm reservation (payment succeeded)
  const handleConfirm = async () => {
    if (!reservation || reservation.status !== 'PENDING' || timeLeft <= 0) return;

    setConfirming(true);
    setApiError(null);

    const idKey = idempotencyKey.trim() || `IDEM-CONF-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

    try {
      // Simulate slightly longer network wait to show premium spinner and state transition
      await new Promise(resolve => setTimeout(resolve, 1500));

      const res = await fetch(`/api/reservations/${reservationId}/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idKey
        }
      });

      const data = await res.json();

      if (!res.ok) {
        setApiError({
          message: data.message || data.error || 'Failed to confirm purchase',
          code: res.status
        });
        
        // Refresh status from server to sync state
        await fetchReservation();
        return;
      }

      // Success! Update local state
      setReservation(data.reservation);
      setApiError(null);
    } catch (err) {
      console.error(err);
      setApiError({
        message: err instanceof Error ? err.message : 'Network error confirming purchase.',
        code: 500
      });
    } finally {
      setConfirming(false);
    }
  };

  // Release reservation early (payment failed or cancelled)
  const handleRelease = async () => {
    if (!reservation || reservation.status !== 'PENDING') return;

    setReleasing(true);
    setApiError(null);

    try {
      const res = await fetch(`/api/reservations/${reservationId}/release`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        }
      });

      const data = await res.json();

      if (!res.ok) {
        setApiError({
          message: data.message || data.error || 'Failed to release reservation',
          code: res.status
        });
        return;
      }

      // Success! Update local state
      setReservation(data.reservation);
      setApiError(null);
    } catch (err) {
      console.error(err);
      setApiError({
        message: err instanceof Error ? err.message : 'Network error releasing hold.',
        code: 500
      });
    } finally {
      setReleasing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center">
        <RefreshCw className="h-9 w-9 text-indigo-500 animate-spin" />
        <p className="mt-4 text-zinc-400 text-sm font-medium">Securing checkout tunnel...</p>
      </div>
    );
  }

  if (error || !reservation) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center p-4">
        <div className="bg-zinc-900 border border-zinc-800 p-8 rounded-2xl max-w-md text-center shadow-xl">
          <XCircle className="h-14 w-14 text-rose-500 mx-auto mb-4" />
          <h2 className="text-xl font-bold text-white tracking-tight">Checkout Error</h2>
          <p className="mt-2 text-zinc-400 text-sm leading-relaxed">{error || 'Unable to retrieve checkout details.'}</p>
          <button 
            onClick={() => router.push('/')}
            className="mt-6 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-sm font-semibold transition-all flex items-center justify-center space-x-2 mx-auto"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Return to Catalog</span>
          </button>
        </div>
      </div>
    );
  }

  const isPending = reservation.status === 'PENDING';
  const isConfirmed = reservation.status === 'CONFIRMED';
  const isReleased = reservation.status === 'RELEASED';

  const totalPrice = reservation.quantity * reservation.product.price;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans pb-20 relative">
      {/* Background radial gradient glow */}
      <div className="absolute top-0 left-0 right-0 h-[450px] bg-gradient-to-b from-indigo-500/10 via-purple-500/5 to-transparent pointer-events-none" />

      {/* Header */}
      <header className="border-b border-zinc-900 bg-zinc-950/20 backdrop-blur-md sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 h-16 flex items-center justify-between">
          <button 
            onClick={() => router.push('/')}
            className="flex items-center space-x-1.5 text-zinc-400 hover:text-white transition-colors text-sm font-semibold"
          >
            <ArrowLeft className="h-4 w-4" />
            <span>Catalog</span>
          </button>
          
          <div className="flex items-center space-x-2">
            <Lock className={`h-4 w-4 ${isConfirmed ? 'text-emerald-400' : isReleased ? 'text-zinc-600' : 'text-indigo-400 animate-pulse'}`} />
            <span className="text-zinc-500 text-xs font-mono">Secure Hold ID: {reservation.id.substring(0, 10)}...</span>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 mt-8">
        
        {/* Status Info Banners */}
        {isConfirmed && (
          <div className="mb-8 bg-emerald-500/10 border border-emerald-500/20 p-5 rounded-2xl flex items-start space-x-4 shadow-lg shadow-emerald-500/[0.02] relative overflow-hidden">
            <div className="absolute top-0 left-0 bottom-0 w-1 bg-emerald-500" />
            <div className="bg-emerald-500/20 p-2.5 rounded-xl text-emerald-400 flex items-center justify-center flex-shrink-0">
              <CheckCircle className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white tracking-tight">Payment Succeeded &amp; Confirmed!</h2>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                Thank you! We have verified your checkout transaction. The units have been permanently deducted from <span className="text-white font-medium">{reservation.warehouse.name}</span>, securing your physical inventory.
              </p>
              <div className="mt-4 flex space-x-3.5">
                <button
                  onClick={() => router.push('/')}
                  className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/10 active:scale-95"
                >
                  Return to Products
                </button>
                <div className="text-zinc-500 text-xxs font-mono flex items-center">
                  ORDER SECURED VIA DB TRANSACTION
                </div>
              </div>
            </div>
          </div>
        )}

        {isReleased && (
          <div className="mb-8 bg-zinc-900/80 border border-zinc-800 p-5 rounded-2xl flex items-start space-x-4 shadow-lg relative overflow-hidden">
            <div className="absolute top-0 left-0 bottom-0 w-1 bg-zinc-600" />
            <div className="bg-zinc-800 p-2.5 rounded-xl text-zinc-400 flex items-center justify-center flex-shrink-0">
              <XCircle className="h-6 w-6" />
            </div>
            <div>
              <h2 className="text-lg font-extrabold text-white tracking-tight">Checkout Hold Released</h2>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                This reservation hold is no longer active. The locked unit has been safely returned to <span className="text-zinc-300 font-medium">{reservation.warehouse.name}</span>&apos;s active available inventory. 
              </p>
              <div className="mt-4">
                <button
                  onClick={() => router.push('/')}
                  className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-xl text-xs font-bold transition-all active:scale-95"
                >
                  Return to Catalog
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Global API Error Alert (410 gone etc) */}
        {apiError && (
          <div className="mb-6 bg-rose-500/10 border border-rose-500/30 text-rose-200 p-4.5 rounded-xl flex items-start space-x-3 relative overflow-hidden animate-in fade-in slide-in-from-top-4 duration-300">
            <div className="absolute top-0 left-0 bottom-0 w-1 bg-rose-500" />
            <div className="bg-rose-500/20 p-2 rounded-lg text-rose-400 flex-shrink-0 mt-0.5">
              <AlertCircle className="h-5 w-5" />
            </div>
            <div className="flex-grow">
              <span className="font-bold text-sm text-white">Transaction Blocked: HTTP {apiError.code}</span>
              <p className="text-xs text-rose-200/80 mt-1">{apiError.message}</p>
              {apiError.code === 410 && (
                <p className="text-xxs text-rose-300/60 mt-1.5 font-mono">
                  EXPLANATION: The 10-minute hold window expired before payment processed. In multi-warehouse brands, this prevents overselling and holding ghost inventory.
                </p>
              )}
            </div>
            <button 
              onClick={() => setApiError(null)}
              className="text-rose-400 hover:text-white text-xs font-semibold bg-rose-500/10 hover:bg-rose-500/20 px-2 rounded-lg transition-all flex-shrink-0 align-self-start"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Live Timer Countdown Banner */}
        {isPending && (
          <div className={`mb-8 p-5 rounded-2xl border flex flex-col sm:flex-row sm:items-center sm:justify-between transition-all ${
            timeLeft < 60 
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-200 shadow-rose-500/[0.02]' 
              : 'bg-indigo-500/10 border-indigo-500/20 text-indigo-200 shadow-indigo-500/[0.02]'
          }`}>
            <div className="flex items-center space-x-3.5">
              <div className={`p-2.5 rounded-xl flex items-center justify-center ${timeLeft < 60 ? 'bg-rose-500/20 text-rose-400' : 'bg-indigo-500/20 text-indigo-400'}`}>
                <Clock className={`h-5 w-5 ${timeLeft < 60 ? 'animate-bounce' : 'animate-spin'}`} style={{ animationDuration: timeLeft < 60 ? '0.8s' : '15s' }} />
              </div>
              <div>
                <h3 className="font-extrabold text-sm text-white">Temporary Stock Reservation Hold</h3>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Your units are reserved and locked for checkout. Confirm payment before this timer expires.
                </p>
              </div>
            </div>

            <div className="mt-4 sm:mt-0 text-left sm:text-right flex-shrink-0 flex sm:flex-col items-baseline sm:items-end justify-between">
              <span className={`text-3xl font-black font-mono tracking-tighter ${timeLeft < 60 ? 'text-rose-400 animate-pulse' : 'text-indigo-400'}`}>
                {formatTime(timeLeft)}
              </span>
              <span className="text-xxs uppercase tracking-wider font-extrabold text-zinc-500 ml-2 sm:ml-0">Hold Time Left</span>
            </div>
          </div>
        )}

        {/* Grid: Invoice Card + Payment Area */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          
          {/* Order Details Invoice Panel */}
          <div className="md:col-span-2 space-y-6">
            
            {/* Invoice Panel */}
            <div className="bg-zinc-900/60 border border-zinc-850 rounded-2xl p-6 shadow-xl relative">
              <div className="flex items-center space-x-2 text-zinc-400 text-xs font-bold uppercase tracking-wider border-b border-zinc-800 pb-4 mb-4">
                <FileText className="h-4 w-4 text-indigo-400" />
                <span>Reserved Items Summary</span>
              </div>

              {/* Item Info */}
              <div className="space-y-4">
                <div>
                  <span className="text-xxs font-mono text-zinc-500 uppercase tracking-widest font-bold">Product Title</span>
                  <h3 className="text-lg font-extrabold text-white mt-0.5">{reservation.product.name}</h3>
                  <p className="text-xxs font-mono text-indigo-400 mt-1 bg-indigo-500/10 border border-indigo-500/20 px-2 py-0.5 rounded-full inline-block">
                    SKU: {reservation.product.sku}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 border-t border-zinc-800/60 pt-4">
                  <div>
                    <span className="text-xxs font-mono text-zinc-500 uppercase tracking-widest font-bold block">Fulfillment Center</span>
                    <span className="text-xs font-bold text-white flex items-center mt-1">
                      <WarehouseIcon className="h-3.5 w-3.5 mr-1 text-zinc-400" />
                      {reservation.warehouse.name}
                    </span>
                  </div>
                  <div>
                    <span className="text-xxs font-mono text-zinc-500 uppercase tracking-widest font-bold block">Physical Quantity</span>
                    <span className="text-xs font-bold text-white mt-1 block">
                      {reservation.quantity} Unit{reservation.quantity > 1 ? 's' : ''} Locked
                    </span>
                  </div>
                </div>
              </div>

              {/* Total Summary */}
              <div className="border-t border-zinc-800 mt-6 pt-5 flex items-center justify-between">
                <div>
                  <span className="text-xs font-bold text-zinc-400">Order Subtotal</span>
                  <p className="text-xxs text-zinc-500 mt-0.5">Calculated with multi-warehouse taxes</p>
                </div>
                <div className="text-right">
                  <span className="text-2xl font-black text-white tracking-tight">${totalPrice.toFixed(2)}</span>
                  <p className="text-xxs text-emerald-400 font-bold uppercase tracking-wider mt-0.5">Free Logistics Shipping</p>
                </div>
              </div>
            </div>

            {/* Technical Detail Card */}
            <div className="bg-zinc-900/20 border border-zinc-850/60 rounded-2xl p-5 text-xs">
              <h4 className="font-bold text-zinc-400 flex items-center space-x-1.5 mb-2.5">
                <HelpCircle className="h-4 w-4 text-zinc-500" />
                <span>Logistics Specs &amp; Hold Details</span>
              </h4>
              <ul className="space-y-2 text-zinc-400 font-normal leading-relaxed">
                <li className="flex justify-between">
                  <span className="text-zinc-500">Hold Expiry Timestamp:</span>
                  <span className="font-mono text-zinc-300 text-xxs">{new Date(reservation.expiresAt).toLocaleString()}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-zinc-500">Reserved Quantity Held:</span>
                  <span className="text-zinc-300 font-medium">{reservation.quantity} (Stock Decremented: {isConfirmed ? 'Permanently' : 'Pending'})</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-zinc-500">Initial Request Timestamp:</span>
                  <span className="font-mono text-zinc-300 text-xxs">{new Date(reservation.createdAt).toLocaleString()}</span>
                </li>
                <li className="flex justify-between">
                  <span className="text-zinc-500">Database Status:</span>
                  <span className={`font-bold text-xxs uppercase tracking-wider px-1.5 py-0.5 rounded font-mono ${
                    isConfirmed ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 
                    isReleased ? 'bg-zinc-800 text-zinc-400' : 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                  }`}>
                    {reservation.status}
                  </span>
                </li>
              </ul>
            </div>
          </div>

          {/* Payment Action Console Panel */}
          <div className="space-y-6">
            
            {/* Payment Area */}
            <div className="bg-zinc-900/60 border border-zinc-850 rounded-2xl p-5 shadow-xl relative overflow-hidden">
              <div className="flex items-center space-x-2 text-zinc-400 text-xs font-bold uppercase tracking-wider border-b border-zinc-800 pb-3.5 mb-4">
                <CreditCard className="h-4 w-4 text-indigo-400" />
                <span>Simulation Gateway</span>
              </div>

              {isPending && timeLeft > 0 ? (
                <div className="space-y-4">
                  {/* Idempotency Key visualization */}
                  <div>
                    <label className="block text-xxs font-bold uppercase tracking-wider text-zinc-500 mb-1">
                      Payment Confirmation Idempotency Key
                    </label>
                    <input
                      type="text"
                      value={idempotencyKey}
                      onChange={(e) => setIdempotencyKey(e.target.value)}
                      placeholder="Confirm Idempotency Key"
                      className="w-full bg-zinc-950 border border-zinc-800 focus:border-indigo-500 rounded-xl px-3 py-2 text-xs font-mono text-indigo-300 focus:outline-none transition-all"
                    />
                    <p className="text-xxs text-zinc-500 mt-1 leading-normal">
                      Ensures retrying payment in low-signal environments is completely safe.
                    </p>
                  </div>

                  <button
                    onClick={handleConfirm}
                    disabled={confirming || timeLeft <= 0}
                    className="w-full bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl py-3 text-xs font-bold transition-all shadow-lg shadow-indigo-600/25 active:scale-97 flex items-center justify-center space-x-2 hover:shadow-indigo-600/35 cursor-pointer disabled:opacity-50"
                  >
                    {confirming ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        <span>Verifying Ledger Stock...</span>
                      </>
                    ) : (
                      <>
                        <span>Confirm Purchase ($ {totalPrice.toFixed(2)})</span>
                      </>
                    )}
                  </button>

                  <button
                    onClick={handleRelease}
                    disabled={releasing}
                    className="w-full bg-zinc-950 border border-zinc-800 text-zinc-400 hover:bg-zinc-900/60 hover:text-white rounded-xl py-2.5 text-xs font-bold transition-all active:scale-97 flex items-center justify-center space-x-1.5 cursor-pointer disabled:opacity-50"
                  >
                    {releasing ? (
                      <>
                        <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                        <span>Releasing hold...</span>
                      </>
                    ) : (
                      <span>Cancel &amp; Release Hold</span>
                    )}
                  </button>
                </div>
              ) : (
                <div className="text-center py-6">
                  <ShoppingBag className={`h-12 w-12 mx-auto mb-3.5 ${isConfirmed ? 'text-emerald-500' : 'text-zinc-600'}`} />
                  <p className="text-sm font-extrabold text-white">
                    {isConfirmed ? 'Payment Complete' : 'Hold Closed'}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1 max-w-[200px] mx-auto leading-relaxed">
                    {isConfirmed 
                      ? 'This order has been verified and stock permanently deducted.' 
                      : 'This checkout hold has been canceled or expired.'}
                  </p>
                  <button
                    onClick={() => router.push('/')}
                    className="mt-5 w-full bg-zinc-800 hover:bg-zinc-700 text-white border border-zinc-700 rounded-xl py-2.5 text-xs font-bold transition-all active:scale-95"
                  >
                    Return to Catalog
                  </button>
                </div>
              )}
            </div>

            {/* Visual Step Tracker */}
            <div className="bg-zinc-900/40 border border-zinc-850 p-5 rounded-2xl text-xxs font-semibold uppercase tracking-wider text-zinc-500">
              <span className="text-zinc-400 block mb-3 font-extrabold tracking-widest text-xxs">Logistics Pipeline State</span>
              <div className="space-y-3.5">
                {[
                  { step: '1', label: 'Hold Created', active: true, done: true },
                  { step: '2', label: 'Inventory Locked', active: isPending, done: isConfirmed },
                  { step: '3', label: 'Payment Validated', active: confirming, done: isConfirmed },
                  { step: '4', label: 'Stock Deducted', active: false, done: isConfirmed }
                ].map((s, idx) => (
                  <div key={idx} className="flex items-center space-x-2.5">
                    <div className={`h-5 w-5 rounded-full flex items-center justify-center text-xxxxs border font-black transition-all ${
                      s.done 
                        ? 'bg-emerald-500/20 border-emerald-500 text-emerald-400' 
                        : s.active 
                          ? 'bg-indigo-500/20 border-indigo-500 text-indigo-400 animate-pulse' 
                          : 'bg-zinc-950 border-zinc-800 text-zinc-600'
                    }`}>
                      {s.step}
                    </div>
                    <span className={s.done ? 'text-zinc-200' : s.active ? 'text-indigo-400 font-bold' : 'text-zinc-600 font-medium'}>{s.label}</span>
                  </div>
                ))}
              </div>
            </div>

          </div>

        </div>

      </main>
    </div>
  );
}
