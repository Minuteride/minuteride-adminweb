'use client';

import { useEffect, useState, useRef } from 'react';
import { supabase } from '../../lib/supabase';

type JobStatus =
  | 'new'
  | 'assigned'
  | 'enroute_pickup'
  | 'in_progress'
  | 'completed'
  | 'canceled';

type Job = {
  id: string;
  status: JobStatus;
  pickup: string | null;
  dropoff: string | null;
  notes: string | null;
  assigned_driver_user_id: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  duration_minutes: number | null;
  fare: number | null;
  driver_payout: number | null;
  started_at: string | null;
  ended_at: string | null;
};

const RATE_PER_MINUTE = 1; // 💰 dollars per minute
const DRIVER_PAYOUT_PERCENT = 0.8; // 1 = 100%, 0.8 = 80%, etc.

export default function DriverPage() {
  const [session, setSession] = useState<any>(null);
  const [userId, setUserId] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [jobs, setJobs] = useState<Job[]>([]);
  const [jobsLoading, setJobsLoading] = useState(false);

  // Trip state
  const [activeTripJobId, setActiveTripJobId] = useState<string | null>(null);
  const [tripStartTime, setTripStartTime] = useState<number | null>(null);
  const [now, setNow] = useState<number>(Date.now());
  const [distanceMeters, setDistanceMeters] = useState<number>(0);

  const geoWatchIdRef = useRef<number | null>(null);
  const lastPositionRef = useRef<{ lat: number; lon: number } | null>(null);

  // Update "now" every second when a trip is active
  useEffect(() => {
    let interval: any;
    if (activeTripJobId && tripStartTime) {
      interval = setInterval(() => setNow(Date.now()), 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [activeTripJobId, tripStartTime]);

  // Auth: load existing session & listen for changes
  useEffect(() => {
    const init = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSession(data.session);
        setUserId(data.session.user.id);
        loadJobs(data.session.user.id);
      }
    };

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, newSession) => {
        setSession(newSession);
        setUserId(newSession?.user?.id ?? null);
        if (newSession?.user?.id) {
          loadJobs(newSession.user.id);
        } else {
          setJobs([]);
        }
      }
    );

    init();

    return () => {
      listener.subscription.unsubscribe();
      stopGeolocation();
    };
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password: password.trim(),
    });
    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    if (data.session) {
      setSession(data.session);
      setUserId(data.session.user.id);
      loadJobs(data.session.user.id);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUserId(null);
    setJobs([]);
    stopGeolocation();
    setActiveTripJobId(null);
    setTripStartTime(null);
    setDistanceMeters(0);
  };

  const loadJobs = async (uid: string) => {
  setJobsLoading(true);
  const { data, error } = await supabase
    .from('jobs')
    .select('*')
    .or(`assigned_driver_user_id.is.null,assigned_driver_user_id.eq.${uid}`)
    .order('created_at', { ascending: false });
 // use id instead of created_at

  if (error) {
    console.error('loadJobs error:', error);
    alert(error.message || 'Error loading jobs (see console)');
    setJobsLoading(false);
    return;
  }

  setJobs((data || []) as Job[]);
  setJobsLoading(false);
};

  // Haversine distance in meters
  const haversineMeters = (
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number
  ) => {
    const R = 6371000; // meters
    const toRad = (v: number) => (v * Math.PI) / 180;

    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  };

  const startGeolocation = () => {
    if (!('geolocation' in navigator)) {
      alert('Geolocation not supported in this browser.');
      return;
    }

    stopGeolocation();

    geoWatchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude, longitude } = pos.coords;
        if (lastPositionRef.current) {
          const d = haversineMeters(
            lastPositionRef.current.lat,
            lastPositionRef.current.lon,
            latitude,
            longitude
          );
          setDistanceMeters((prev) => prev + d);
        }
        lastPositionRef.current = { lat: latitude, lon: longitude };
      },
      (err) => {
        console.error(err);
      },
      {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
      }
    );
  };

  const stopGeolocation = () => {
    if (geoWatchIdRef.current !== null) {
      navigator.geolocation.clearWatch(geoWatchIdRef.current);
      geoWatchIdRef.current = null;
    }
    lastPositionRef.current = null;
  };

  const handleClaimJob = async (jobId: string) => {
  if (!userId) return;

  const { error } = await supabase
    .from('jobs')
    .update({
      assigned_driver_user_id: userId,
      status: 'assigned',
    })
    .eq('id', jobId)
    .is('assigned_driver_user_id', null); // only if still unclaimed

  if (error) {
    console.error('handleClaimJob error:', error);
    alert(error.message || 'Error claiming job');
    return;
  }

  // Just reload jobs; if claim failed quietly, job will still look unassigned
  loadJobs(userId);
};

  const handleStartTrip = async (job: Job) => {
    if (!userId) return;

    if (activeTripJobId && activeTripJobId !== job.id) {
      alert('Another trip is already in progress. End that one first.');
      return;
    }

    const nowIso = new Date().toISOString();

    const { error } = await supabase
      .from('jobs')
      .update({
        status: 'in_progress',
        started_at: nowIso,
      })
      .eq('id', job.id)
      .eq('assigned_driver_user_id', userId);

    if (error) {
      console.error(error);
      alert('Error starting trip');
      return;
    }

    setActiveTripJobId(job.id);
    setTripStartTime(Date.now());
    setDistanceMeters(0);
    startGeolocation();
    loadJobs(userId);
  };

const handleEndTrip = async (job: Job) => {
  if (!userId || !activeTripJobId || activeTripJobId !== job.id || !tripStartTime) {
    alert('No active trip to end.');
    return;
  }

  stopGeolocation();

  const endTime = Date.now();
  const durationSeconds = Math.max(
    1,
    Math.floor((endTime - tripStartTime) / 1000)
  );

  // store minutes as an INTEGER (rounded)
  const durationMinutesInt = Math.max(1, Math.round(durationSeconds / 60));

  // If job already has distance_meters, prefer that; else use local distance
  const totalDistanceMeters =
    typeof job.distance_meters === 'number' && job.distance_meters > 0
      ? job.distance_meters
      : distanceMeters;

  const distanceMetersInt = Math.max(0, Math.round(totalDistanceMeters));

  // Money: round to 2 decimals
  const fareRaw = durationMinutesInt * RATE_PER_MINUTE;
  const fare = Number(fareRaw.toFixed(2));

  const driverPayoutRaw = fare * DRIVER_PAYOUT_PERCENT;
  const driverPayout = Number(driverPayoutRaw.toFixed(2));

  const { error } = await supabase
    .from('jobs')
    .update({
      status: 'completed',
      duration_seconds: durationSeconds,
      duration_minutes: durationMinutesInt,
      distance_meters: distanceMetersInt,
      fare,
      driver_payout: driverPayout,
    })
    .eq('id', job.id);

  if (error) {
    console.error('handleEndTrip error full:', error);
    try {
      alert(
        (error as any).message ||
          JSON.stringify(error) ||
          'Error ending trip (full update)'
      );
    } catch {
      alert('Error ending trip (could not stringify error)');
    }
    return;
  }

  setActiveTripJobId(null);
  setTripStartTime(null);
  setDistanceMeters(0);

  if (userId) {
    loadJobs(userId);
  }
};

  // Derived live timer values
  const activeDurationSeconds =
    activeTripJobId && tripStartTime ? Math.floor((now - tripStartTime) / 1000) : 0;
  const activeDurationMinutes = activeDurationSeconds / 60;
  const activeFare = activeDurationMinutes * RATE_PER_MINUTE;

  // ---------- RENDER ----------

  if (!session) {
    // Login screen
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-100">
        <div className="bg-white shadow-md rounded-xl p-6 w-full max-w-sm space-y-4">
          <h1 className="text-xl font-bold text-center">MinuteRide Driver</h1>
          <input
            className="w-full border rounded-md px-3 py-2 text-sm"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full border rounded-md px-3 py-2 text-sm"
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            onClick={handleLogin}
            disabled={loading}
            className="w-full bg-black text-white rounded-md py-2 text-sm font-semibold"
          >
            {loading ? 'Logging in…' : 'Log in'}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="flex items-center justify-between px-4 py-3 bg-black text-white">
        <div>
          <h1 className="text-lg font-bold">MinuteRide Driver</h1>
          <p className="text-xs text-slate-200">
            Logged in as {session.user?.email}
          </p>
        </div>
        <button
          onClick={handleLogout}
          className="text-xs border border-white rounded-md px-2 py-1"
        >
          Log out
        </button>
      </header>

      {activeTripJobId && (
        <div className="bg-blue-100 text-blue-900 px-4 py-2 text-sm">
          <p>
            Active trip: {activeDurationMinutes.toFixed(1)} min — est. $
            {activeFare.toFixed(2)}
          </p>
          {distanceMeters > 0 && (
            <p>
              Distance: {(distanceMeters / 1609.34).toFixed(2)} miles (approx.)
            </p>
          )}
        </div>
      )}

      <main className="flex-1 p-4 space-y-3">
        <div className="flex justify-between items-center mb-2">
          <h2 className="text-base font-semibold">Jobs</h2>
          <button
            onClick={() => userId && loadJobs(userId)}
            className="text-xs border border-slate-300 rounded-md px-2 py-1"
          >
            {jobsLoading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>

        {jobs.length === 0 && (
          <p className="text-sm text-slate-500">No jobs available.</p>
        )}

        <div className="space-y-3">
          {jobs.map((job) => {
            const isMine = job.assigned_driver_user_id === userId;
            const isActive =
              activeTripJobId === job.id && job.status === 'in_progress';

            const distanceMiles =
              job.distance_meters != null
                ? job.distance_meters / 1609.34
                : null;

            const storedMinutes =
              job.duration_minutes ??
              (job.duration_seconds ? job.duration_seconds / 60 : null);

            return (
              <div
                key={job.id}
                className="bg-white rounded-lg shadow-sm p-3 border border-slate-200"
              >
                <div className="flex justify-between items-center mb-1">
                  <div>
                    <p className="text-sm font-semibold">
                      {job.pickup || 'No pickup'} → {job.dropoff || 'No dropoff'}
                    </p>
                    <p className="text-xs text-slate-500">
                      Status: {job.status}
                    </p>
                  </div>
                </div>

                {job.notes && (
                  <p className="text-xs text-slate-600 mb-1">
                    Notes: {job.notes}
                  </p>
                )}

                {distanceMiles != null && (
                  <p className="text-xs text-slate-600">
                    Distance: {distanceMiles.toFixed(2)} miles
                  </p>
                )}

                {storedMinutes != null && (
                  <p className="text-xs text-slate-600">
                    Duration: {storedMinutes.toFixed(1)} min
                  </p>
                )}

                {job.fare != null && (
                  <p className="text-xs text-slate-600">
                    Fare: ${job.fare.toFixed(2)}
                  </p>
                )}

                {job.driver_payout != null && (
                  <p className="text-xs text-slate-600">
                    Driver payout: ${job.driver_payout.toFixed(2)}
                  </p>
                )}

                {isActive && (
                  <p className="text-xs text-blue-700 mt-1">
                    Live: {activeDurationMinutes.toFixed(1)} min — $
                    {activeFare.toFixed(2)}
                  </p>
                )}

                <div className="flex gap-2 mt-2">
                  {/* Claim if unassigned */}
                  {!isMine && job.assigned_driver_user_id == null && (
                    <button
                      onClick={() => handleClaimJob(job.id)}
                      className="flex-1 text-xs bg-emerald-600 text-white rounded-md px-2 py-1"
                    >
                      Claim
                    </button>
                  )}

                  {/* Start / End buttons for my jobs */}
                  {isMine && job.status === 'assigned' && (
                    <button
                      onClick={() => handleStartTrip(job)}
                      className="flex-1 text-xs bg-black text-white rounded-md px-2 py-1"
                    >
                      Start Trip
                    </button>
                  )}

                  {isMine && job.status === 'in_progress' && (
                    <button
                      onClick={() => handleEndTrip(job)}
                      className="flex-1 text-xs bg-red-600 text-white rounded-md px-2 py-1"
                    >
                      End Trip
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </main>
    </div>
  );
}
