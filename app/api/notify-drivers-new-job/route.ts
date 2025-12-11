// app/api/notify-drivers-new-job/route.ts

import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

type DriverRow = {
  phone_number: string | null;
  sms_notifications_enabled: boolean | null;
};

export async function POST(request: Request) {
  try {
    // --- Supabase envs ---
    const supabaseUrl =
      process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error('Supabase misconfigured', {
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

    // --- Twilio envs ---
    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_FROM_NUMBER;

    if (!twilioSid || !twilioToken || !twilioFrom) {
      console.error('Twilio misconfigured', {
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const twilioClient = twilio(twilioSid, twilioToken);

    // Body is not super important for SMS – just for text
    let pickup: string | undefined;
    let dropoff: string | undefined;

    try {
      const body = (await request.json()) as {
        pickup?: string;
        dropoff?: string;
      };
      pickup = body.pickup;
      dropoff = body.dropoff;
    } catch {
      // If parsing fails, just leave them undefined
      pickup = undefined;
      dropoff = undefined;
    }

    // --- Fetch drivers who want SMS ---
    const { data: drivers, error: driversError } = await supabase
      .from('drivers') // no generic here – we cast below
      .select('phone_number, sms_notifications_enabled')
      .eq('sms_notifications_enabled', true);

    const typedDrivers = (drivers ?? []) as DriverRow[];

    if (driversError) {
      console.error('Supabase drivers query error', driversError);
      return NextResponse.json(
        {
          error: 'Failed to fetch drivers',
          supabaseMessage: driversError.message,
          supabaseCode: driversError.code,
          supabaseDetails: driversError.details ?? null,
        },
        { status: 500 }
      );
    }

    if (!typedDrivers || typedDrivers.length === 0) {
      console.log('No drivers with sms_notifications_enabled = true');
      return NextResponse.json(
        { ok: true, message: 'No drivers with SMS enabled' },
        { status: 200 }
      );
    }

    const messageText = `🚗 New MinuteRide job:
Pickup: ${pickup || 'N/A'}
Dropoff: ${dropoff || 'N/A'}
Log in now to claim it.`;

    const results = await Promise.allSettled(
      typedDrivers
        .filter((d) => !!d.phone_number)
        .map((d) =>
          twilioClient.messages.create({
            body: messageText,
            from: twilioFrom,
            to: d.phone_number!,
          })
        )
    );

    console.log('Twilio SMS results:', JSON.stringify(results, null, 2));

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: any) {
    console.error('Fatal error in notify-drivers-new-job route', err);
    return NextResponse.json(
      {
        error: 'Internal error in notify-drivers-new-job',
        message: err?.message ?? String(err),
      },
      { status: 500 }
    );
  }
}
