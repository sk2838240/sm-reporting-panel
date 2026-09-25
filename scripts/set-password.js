// One-off admin utility: set a user's password (and confirm them) without
// sending any email.
//
// Why this exists: passwords are NOT stored in the app's database tables or in
// these source files. Supabase Auth keeps them bcrypt-hashed in its internal
// `auth.users` table, and the app never compares a password itself — it calls
// supabase.auth.signInWithPassword() and lets Supabase decide. So there is no
// column to write to and no config value to set.
//
// This uses the same Admin API that the Supabase dashboard and the app's own
// /api/reset-password route use. No SMTP, no email, works immediately.
//
// Usage (run from the project root):
//
//   SUPABASE_URL="https://xxxx.supabase.co" \
//   SUPABASE_SERVICE_ROLE_KEY="<service_role key>" \
//   node scripts/set-password.js admin@example.com 'MyNewPassword123!'
//
// The service-role key is in Supabase -> Project Settings -> API. It is a
// secret: pass it inline as above, do not commit it or paste it anywhere.
//
// This script is a local admin convenience. Delete it if you don't want it in
// the repo.
import { createClient } from '@supabase/supabase-js';

const [email, password] = process.argv.slice(2);

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function fail(msg) {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
}

if (!email || !password) {
  console.error(`
  Set a user's password without email.

    SUPABASE_URL="https://xxxx.supabase.co" \\
    SUPABASE_SERVICE_ROLE_KEY="<service_role key>" \\
    node scripts/set-password.js <email> '<new password>'
`);
  process.exit(1);
}

if (!url) fail('SUPABASE_URL is not set (or NEXT_PUBLIC_SUPABASE_URL).');
if (!serviceKey) fail('SUPABASE_SERVICE_ROLE_KEY is not set. Get it from Supabase → Project Settings → API.');
if (password.length < 6) fail('Supabase requires a password of at least 6 characters.');

const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

// Find the user by email.
const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 1000 });
if (error) fail(`Could not list users: ${error.message}`);

const users = data?.users || [];
const match = users.find((u) => (u.email || '').toLowerCase() === email.trim().toLowerCase());

if (!match) {
  console.error(`\n  ✗ No account exists for ${email}.`);
  if (users.length) {
    console.error('    Existing accounts:');
    for (const u of users) console.error(`      - ${u.email}${u.email_confirmed_at ? '' : '  (unconfirmed)'}`);
  } else {
    console.error('    There are no users at all yet — create one with "Add user" in Supabase → Authentication → Users.');
  }
  console.error('');
  process.exit(1);
}

// Set the password and confirm the address so sign-in works immediately.
const { error: updateErr } = await supabase.auth.admin.updateUserById(match.id, {
  password,
  email_confirm: true,
});

if (updateErr) fail(`Could not update ${email}: ${updateErr.message}`);

console.log(`\n  ✓ Password set for ${email} (id ${match.id}) and the address is confirmed.`);
console.log('    Sign in with that email and the password you just passed.\n');
