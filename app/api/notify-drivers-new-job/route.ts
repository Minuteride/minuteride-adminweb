import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import twilio from 'twilio';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!
);

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { pickup, dropoff } = body as {
      pickup?: string;
      dropoff?: string;
    };

    const { data: drivers, error } = await supabase
      .from('drivers')
      .select('phone_number')
      .eq('sms_notifications_enabled', true);

    if (error) {
      console.error('Error fetching drivers', error);
      return NextResponse.json(
        { error: 'Failed to fetch drivers' },
        { status: 500 }
      );
    }

    if (!drivers || drivers.length === 0) {
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
        .filter((d: any) => d.phone_number)
        .map((d: any) =>
          twilioClient.messages.create({
            body: messageText,
            from: process.env.TWILIO_FROM_NUMBER!,
            to: d.phone_number!,
          })
        )
    );

    console.log('SMS results:', results);

    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Error in notify-drivers-new-job route', err);
    return NextResponse.json(
      { error: 'Internal error sending SMS' },
      { status: 500 }
    );
  }
}
