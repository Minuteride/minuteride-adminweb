// app/api/notify-drivers-new-job/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    // Read Supabase vars (two possible names for URL, one for service key)
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    // Read Twilio vars
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_FROM_NUMBER;

    // ---- Supabase env check ----
    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase config missing', {
        hasUrl: !!supabaseUrl,
        hasServiceKey: !!supabaseServiceKey,
      });
      return NextResponse.json(
        {
          error: 'Missing Supabase configuration',
          hasUrl: !!supabaseUrl,
          hasServiceKey: !!supabaseServiceKey,
        },
        { status: 500 }
      );
    }

    // ---- Twilio env check ----
    if (!twilioSid || !twilioToken || !twilioFrom) {
      console.error('Twilio config missing', {
        hasSid: !!twilioSid,
        hasToken: !!twilioToken,
        hasFrom: !!twilioFrom,
      });
      return NextResponse.json(
        {
          error: 'Missing Twilio configuration',
          hasSid: !!twilioSid,
          hasToken: !!twilioToken,
          hasFrom: !!twilioFrom,
        },
        { status: 500 }
      );
    }

    // Create clients
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const twilioClient = twilio(twilioSid, twilioToken);

    // Read body safely
    let pickup = '';
    let dropoff = '';
    try {
      const body = (await request.json()) as {
        pickup?: string;
        dropoff?: string;
      };
      pickup = body.pickup || '';
      dropoff = body.dropoff || '';
    } catch {
      // if body parse fails, just leave them empty
    }

    // Get drivers who enabled SMS notifications
    const { data: drivers, error: driversError } = await supabase
      .from('drivers')
      .select('phone_number')
      .eq('sms_notifications_enabled', true);

    if (driversError) {
      console.error('Error fetching drivers from Supabase', driversError);
      return NextResponse.json(
        { error: 'Failed to fetch drivers' },
        { status: 500 }
      );
    }

    if (!drivers || drivers.length === 0) {
      console.log('No drivers with SMS enabled');
      return NextResponse.json(
        { message: 'No drivers with SMS enabled' },
        { status: 200 }
      );
    }

    const messageText = `🚗 New MinuteRide job:
Pickup: ${pickup || 'N/A'}
Dropoff: ${dropoff || 'N/A'}
Log in now to claim it.`;

    const results = await Promise.allSettled(
      drivers
        .map((d: any) => d.phone_number as string | null)
        .filter((phone): phone is string => !!phone)
        .map((phone) =>
          twilioClient.messages.create({
            body: messageText,
            from: twilioFrom!,
            to: phone,
          })
        )
    );

    console.log('SMS send results:', results);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error in notify-drivers-new-job route', err);
    return NextResponse.json(
      { error: 'Internal error sending SMS' },
      { status: 500 }
    );
  }
}
