import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://rtlvrvubgxlgbixfmscc.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJ0bHZydnViZ3hsZ2JpeGZtc2NjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjMwNjU5MzAsImV4cCI6MjA3ODY0MTkzMH0.psc-FlF0ekTh9YRkOxim9ZCRtvb70Tnzy7qeg7iBbLg';

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error('Missing Supabase credentials');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
