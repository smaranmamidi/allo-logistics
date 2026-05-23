import { NextRequest, NextResponse } from 'next/server';
import { releaseExpiredReservations } from '@/lib/cleanup';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  // Optional security: If a CRON_SECRET is configured in .env, enforce Authorization checking
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronSecret.trim() !== '') {
    const authHeader = req.headers.get('Authorization') || req.headers.get('authorization');
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or missing CRON_SECRET authorization header' },
        { status: 401 }
      );
    }
  }

  try {
    console.log('[Cron] Active background cleanup triggered.');
    const releasedCount = await releaseExpiredReservations();

    return NextResponse.json({
      success: true,
      message: `Active cleanup completed. Released ${releasedCount} expired reservations.`,
      releasedCount
    }, { status: 200 });
  } catch (error) {
    console.error('[Cron] Error during active background cleanup:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

// Support GET requests as well for easy pinging from simple external cron tools
export async function GET(req: NextRequest) {
  // Reuse same security logic
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && cronSecret.trim() !== '') {
    const url = new URL(req.url);
    const keyQuery = url.searchParams.get('key');
    if (keyQuery !== cronSecret) {
      return NextResponse.json(
        { error: 'Unauthorized', message: 'Invalid or missing CRON_SECRET search query parameter' },
        { status: 401 }
      );
    }
  }

  try {
    const releasedCount = await releaseExpiredReservations();
    return NextResponse.json({
      success: true,
      message: `Active cleanup completed. Released ${releasedCount} expired reservations.`,
      releasedCount
    }, { status: 200 });
  } catch (error) {
    console.error('[Cron] Error during active background cleanup:', error);
    return NextResponse.json(
      { error: 'Internal Server Error', details: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
