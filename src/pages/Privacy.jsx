import { ShieldCheck, Database, Mail, Lock, Eye } from 'lucide-react';
import { BackButton } from '../components/ui';

export default function Privacy() {
  const items = [
    { icon: Database, title: 'What we store', body: 'Performance metrics you see here — clicks, impressions, rankings, ratings, follower counts, post activity — are entered manually by your agency team each month. We do not connect to your Google, Meta, or review-platform accounts.' },
    { icon: Eye, title: 'Who can see it', body: 'Only you and your assigned agency team can view your data. Team members see only the clients assigned to them; an agency super admin oversees everything. Access is enforced both in the app and at the database level.' },
    { icon: Lock, title: 'How it is protected', body: 'Your account is protected by a password and (where enabled) Google sign-in. The agency does not store payment-card data through this portal. Passwords are managed by a secure authentication provider and are never visible to agency staff.' },
    { icon: Mail, title: 'Notifications', body: 'When a new monthly report is published or updated, you receive an in-app notification and (optionally) an email. You can change your password anytime via the “Forgot password?” link on the sign-in page.' },
  ];
  return (
    <div className='min-h-screen bg-slate-50'>
      <div className='max-w-3xl mx-auto px-6 py-12'>
        <BackButton to='/app' className='mb-6' />
        <div className='flex items-center gap-3 mb-2'>
          <div className='flex h-11 w-11 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white'><ShieldCheck className='w-6 h-6' /></div>
          <h1 className='text-2xl font-bold text-slate-900 dark:text-slate-100'>Privacy & data handling</h1>
        </div>
        <p className='text-slate-500 mb-8'>How your agency reporting portal handles your information.</p>
        <div className='grid sm:grid-cols-2 gap-4'>
          {items.map((it) => (
            <div key={it.title} className='rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-5'>
              <div className='flex h-10 w-10 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 mb-3'><it.icon className='w-5 h-5' /></div>
              <h3 className='font-semibold text-slate-900 dark:text-slate-100'>{it.title}</h3>
              <p className='text-sm text-slate-600 dark:text-slate-400 mt-1 leading-relaxed'>{it.body}</p>
            </div>
          ))}
        </div>
        <p className='text-xs text-slate-400 mt-8'>This is a basic client-facing notice. For questions about your specific data, contact your account manager.</p>
      </div>
    </div>
  );
}
