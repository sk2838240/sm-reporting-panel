import { createClient } from '@supabase/supabase-js';

// Frontend uses the ANON key only. The service-role key never reaches the client bundle.
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

export default supabase;
