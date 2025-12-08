'use client';
import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';

type Job = {
  id: string;
  status: 'new'|'assigned'|'enroute_pickup'|'in_progress'|'completed'|'canceled';
  pickup: string | null;
  dropoff: string | null;
  notes: string | null;
  assigned_driver_user_id: string | null;

  // optional so TypeScript / build never freaks out
  duration_minutes?: number | null;
  fare?: number | null;
  driver_payout?: number | null;
};

type DriverRow = { auth_user_id: string; full_name: string | null };

export default function Page() {
  const [session, setSession] = useState<any>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [jobs, setJobs] = useState<Job[]>([]);
  const [form, setForm] = useState({ pickup:'', dropoff:'', notes:'' });
  const [assignTo, setAssignTo] = useState('');
  const [drivers, setDrivers] = useState<DriverRow[]>([]);

  // auth listener
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, sess) => setSession(sess));
    return () => sub.subscription.unsubscribe();
  }, []);

  // load data + realtime (and send push notifications on new jobs)
  useEffect(() => {
    if (!session) return;

    // initial load
    loadAll();

    console.log('🔔 Setting up jobs-rt realtime channel');

    const channel = supabase
      .channel('jobs-rt')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'jobs' },
        async (payload: any) => {
          console.log('🔔 jobs-rt change payload:', payload);

          // always reload jobs + drivers so dashboard stays in sync
          loadAll();

          // only send push notifications for NEW jobs
          if (payload.eventType === 'INSERT') {
            const newJob = payload.new;
            console.log('🔔 New job inserted, preparing to send push notifications:', newJob);

            try {
              // 1️⃣ get all users that have a push token
              const { data: users, error } = await supabase
                .from('users_public')
                .select('expo_push_token')
                .not('expo_push_token', 'is', null);

              if (error) {
                console.log('❌ Error fetching users with expo_push_token:', error.message);
                return;
              }

              if (!users || users.length === 0) {
                console.log('ℹ️ No users with expo_push_token, skipping push');
                return;
              }

              // 2️⃣ build a message for each user
              const messages = users.map((u: { expo_push_token: string }) => ({
                to: u.expo_push_token,
                sound: 'default',
                title: 'New MinuteRide job available',
                body: `${newJob.pickup || 'Pickup unknown'} → ${newJob.dropoff || 'Dropoff unknown'}`,
                data: { jobId: newJob.id },
              }));

              // 3️⃣ send to Expo push API
              const res = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify(messages),
              });

              const data = await res.json();
              console.log('✅ Push sent, Expo response:', JSON.stringify(data));
            } catch (err: any) {
              console.log('❌ Error sending push notifications:', err?.message || err);
            }
          }
        }
      )
      .subscribe();

    // cleanup: remove channel when component / session changes
    return () => {
      console.log('🧹 Removing jobs-rt channel');
      supabase.removeChannel(channel);
    };
  }, [session]);

  const loadAll = async () => {
    const j = await supabase
      .from('jobs')
      .select('*')
      .order('created_at', { ascending: false });

    setJobs((j.data as any) || []);

    const d = await supabase
      .from('users_public')
      .select('auth_user_id, full_name')
      .eq('role','driver');

    setDrivers((d.data as any) || []);
  };

  const signIn = async () => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) alert(error.message);
  };

  const createJob = async () => {
    if (!form.pickup || !form.dropoff) {
      alert('Enter pickup and dropoff');
      return;
    }

    const { data, error } = await supabase
      .from('jobs')
      .insert({
        pickup: form.pickup,
        dropoff: form.dropoff,
        notes: form.notes || null,
        created_by_user_id: session?.user?.id ?? null
      })
      .select()
      .single();

    if (error) {
      alert(error.message);
      return;
    }

    // 🔔 Fire SMS notifications (does not block the UI)
    fetch('/api/notify-drivers-new-job', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pickup: data.pickup,
        dropoff: data.dropoff,
      }),
    }).catch((err) => {
      console.error('Failed to call SMS notify API', err);
    });

    setForm({ pickup:'', dropoff:'', notes:'' });
  };

  const assignJob = async (jobId: string) => {
    if (!assignTo) return alert('Pick a driver first');
    const { error } = await supabase.from('jobs').update({
      status: 'assigned',
      assigned_driver_user_id: assignTo
    }).eq('id', jobId);
    if (error) alert(error.message);
  };

  const setStatus = async (jobId: string, status: Job['status']) => {
    const { error } = await supabase.from('jobs').update({ status }).eq('id', jobId);
    if (error) alert(error.message);
  };

  if (!session) {
    return (
      <div style={{ maxWidth: 480, margin:'60px auto', fontFamily: 'ui-sans-serif, system-ui' }}>
        <h1>MinuteRide — Dispatcher</h1>
        <label>Email</label>
        <input
          value={email}
          onChange={e=>setEmail(e.target.value)}
          style={{ display:'block', width:'100%', padding:8, marginBottom:8 }}
        />
        <label>Password</label>
        <input
          type="password"
          value={password}
          onChange={e=>setPassword(e.target.value)}
          style={{ display:'block', width:'100%', padding:8, marginBottom:12 }}
        />
        <button onClick={signIn} style={{ padding:'10px 16px' }}>Sign In</button>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 1000, margin:'30px auto', fontFamily: 'ui-sans-serif, system-ui' }}>
      <h2>Dispatcher Dashboard</h2>

      <div style={{ border:'1px solid #ddd', padding:12, borderRadius:10, marginBottom:16 }}>
        <h3>Create Job</h3>
        <input
          placeholder='Pickup address'
          value={form.pickup}
          onChange={e=>setForm({...form, pickup:e.target.value})}
          style={{ width:'100%', padding:8, marginBottom:8 }}
        />
        <input
          placeholder='Dropoff address'
          value={form.dropoff}
          onChange={e=>setForm({...form, dropoff:e.target.value})}
          style={{ width:'100%', padding:8, marginBottom:8 }}
        />
        <input
          placeholder='Notes (optional)'
          value={form.notes}
          onChange={e=>setForm({...form, notes:e.target.value})}
          style={{ width:'100%', padding:8, marginBottom:8 }}
        />
        <button onClick={createJob} style={{ padding:'10px 16px' }}>Add Job</button>
      </div>

      <div style={{ border:'1px solid #ddd', padding:12, borderRadius:10 }}>
        <h3>Jobs</h3>

        <div style={{ marginBottom:8 }}>
          <label>Assign to driver: </label>
          <select
            value={assignTo}
            onChange={e=>setAssignTo(e.target.value)}
            style={{ padding:6 }}
          >
            <option value=''>-- pick driver --</option>
            {drivers.map(d => (
              <option key={d.auth_user_id} value={d.auth_user_id}>
                {d.full_name || d.auth_user_id}
              </option>
            ))}
          </select>
        </div>

        {jobs.map(j => {
          const fare = Number(j.fare ?? 0);
          const payout = Number(j.driver_payout ?? 0);
          const duration = Number(j.duration_minutes ?? 0);
          const profit = fare - payout;

          return (
            <div key={j.id} style={{ border:'1px solid #eee', borderRadius:8, padding:10, marginBottom:8 }}>
              <div><b>{j.pickup}</b> → {j.dropoff}</div>
              {j.notes && <div style={{ color:'#555' }}>Notes: {j.notes}</div>}
              <div>
                Status: {j.status}
                {j.assigned_driver_user_id && (
                  <> | Driver: {drivers.find(d=>d.auth_user_id===j.assigned_driver_user_id)?.full_name || 'Unknown'}</>
                )}
              </div>

              {(j.fare != null || j.driver_payout != null || j.duration_minutes != null) && (
                <div style={{ marginTop:6, fontSize:14, color:'#333' }}>
                  <div>Duration: {duration} min</div>
                  <div>Fare: ${fare.toFixed(2)}</div>
                  <div>Driver payout: ${payout.toFixed(2)}</div>
                  <div><b>Company profit:</b> ${profit.toFixed(2)}</div>
                </div>
              )}

              <div style={{ marginTop:6 }}>
                <button onClick={()=>assignJob(j.id)} style={{ marginRight:8 }}>Assign</button>
                <button onClick={()=>setStatus(j.id,'enroute_pickup')} style={{ marginRight:8 }}>En-route</button>
                <button onClick={()=>setStatus(j.id,'in_progress')} style={{ marginRight:8 }}>Start</button>
                <button onClick={()=>setStatus(j.id,'completed')} style={{ marginRight:8 }}>Complete</button>
                <button onClick={()=>setStatus(j.id,'canceled')}>Cancel</button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
