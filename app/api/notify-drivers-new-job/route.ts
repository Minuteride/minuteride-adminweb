import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

export async function POST(request: Request) {
  try {
    //
    // 🟦 Read environment variables safely
    //
    const supabaseUrl =
      process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;

    const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    const twilioSid = process.env.TWILIO_ACCOUNT_SID;
    const twilioToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_FROM_NUMBER;

    //
    // 🟥 Validate required env vars
    //
    if (!supabaseUrl) {
      console.error('Missing SUPABASE_URL');
      return NextResponse.json({ error: 'Missing Supabase URL' }, { status: 500 });
    }

    if (!supabaseServiceKey) {
      console.error('Missing SUPABASE_SERVICE_ROLE_KEY');
      return NextResponse.json(
        { error: 'Missing Supabase Service Key' },
        { status: 500 }
      );
    }

    if (!twilioSid || !twilioToken || !twilioFrom) {
      console.error('Missing Twilio configuration');
      return NextResponse.json(
        { error: 'Missing Twilio configuration' },
        { status: 500 }
      );
    }

    //
    // 🟦 Initialize clients
    //
    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const twilioClient = twilio(twilioSid, twilioToken);

    //
    // 🟦 Parse request body
    //
    const body = await request.json();
    const { pickup, dropoff } = body as {
      pickup?: string;
      dropoff?: string;
    };

    //
    // 🟦 Fetch drivers with SMS enabled
    //
    const { data: drivers, error } = await supabase
      .from('drivers')
      .select('phone_number')
      .eq('sms_notifications_enabled', true);

    if (error) {
      console.error('Error fetching drivers:', error);
      return NextResponse.json(
        { error: 'Failed to fetch drivers' },
        { status: 500 }
      );
    }

    if (!drivers || drivers.length === 0) {
      console.log('No drivers have SMS enabled');
      return NextResponse.json({ message: 'No drivers to notify' }, { status: 200 });
    }

    //
    // 🟦 SMS message content
    //
    const messageText = `🚗 New MinuteRide job:
Pickup: ${pickup || 'N/A'}
Dropoff: ${dropoff || 'N/A'}
Log in now to claim it.`;

    //
    // 🟦 Send SMS to all eligible drivers
    //
    const results = await Promise.allSettled(
      drivers
        .filter((d: any) => d.phone_number)
        .map((d: any) =>
          twilioClient.messages.create({
            body: messageText,
            from: twilioFrom,
            to: d.phone_number!,
          })
        )
    );

    console.log('SMS results:', results);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error in notify-drivers-new-job route:', err);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
