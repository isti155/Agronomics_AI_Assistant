import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Layout from '../components/Layout';
import { getUserFields } from '../lib/db';
import type { Field } from '../types';
import {
  Sprout,
  ScanLine,
  Map as MapIcon,
  Lightbulb,
  ArrowRight,
  Mic,
  CloudSun,
  Droplets,
} from 'lucide-react';
import Weather from '../components/Weather';
import { cn } from '../lib/utils';

// --- Greeting Component ---
function Greeting({ name, fieldCount, totalAcres, activeCount }: { name: string, fieldCount: number, totalAcres: number, activeCount: number }) {
  const { t } = useApp();
  return (
    <section className="space-y-3">
      <div className="space-y-0.5">
        <p className="text-sm font-medium text-on-surface-variant/70">Hello,</p>
        <h2 className="text-3xl font-sans font-extrabold text-on-surface tracking-tight">
          {name || 'Farmer'}
        </h2>
      </div>
      
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 bg-primary/10 px-3 py-1.5 rounded-lg border border-primary/10">
          <div className="w-1.5 h-1.5 rounded-full bg-primary" />
          <span className="text-[10px] font-bold text-primary uppercase tracking-wider">synced 2m ago</span>
        </div>
        <div className="bg-amber-100 px-3 py-1.5 rounded-lg border border-amber-200">
          <span className="text-[10px] font-bold text-amber-800 uppercase tracking-wider">1 Alerts</span>
        </div>
      </div>
    </section>
  );
}

// --- Summary Stats ---
function SummaryStats({ fieldCount, totalAcres, activeCount }: { fieldCount: number, totalAcres: number, activeCount: number }) {
  const navigate = useNavigate();
  return (
    <section className="grid grid-cols-2 gap-4">
      <div 
        onClick={() => navigate('/fields')}
        className="bg-white rounded-3xl p-5 border border-outline-variant/10 shadow-sm space-y-1 cursor-pointer active:scale-95 transition-transform"
      >
        <p className="text-xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Fields</p>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-black text-on-surface">{fieldCount}</span>
        </div>
        <p className="text-xs font-bold text-on-surface-variant/40">{totalAcres.toFixed(1)} acres</p>
      </div>

      <div 
        onClick={() => navigate('/my-crops')}
        className="bg-white rounded-3xl p-5 border border-outline-variant/10 shadow-sm space-y-1 cursor-pointer active:scale-95 transition-transform"
      >
        <p className="text-xs font-bold text-on-surface-variant/60 uppercase tracking-widest">Active</p>
        <div className="flex items-baseline gap-1">
          <span className="text-2xl font-black text-on-surface">{activeCount}</span>
        </div>
        <p className="text-xs font-bold text-on-surface-variant/40">growing</p>
      </div>
    </section>
  );
}

// --- My Fields Component ---
function MyFields({ fields }: { fields: Field[] }) {
  const { t } = useApp();
  const navigate = useNavigate();

  return (
    <section className="space-y-4">
      <div className="flex justify-between items-end px-1">
        <h3 className="text-lg font-sans font-extrabold text-on-surface">
          Your fields
        </h3>
        <button 
          onClick={() => navigate('/fields')}
          className="text-on-surface-variant font-bold text-xs flex items-center gap-1 opacity-70"
        >
          See all <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="bg-white rounded-3xl border border-outline-variant/10 shadow-sm overflow-hidden divide-y divide-outline-variant/5">
        {fields.length === 0 ? (
          <div className="p-8 text-center space-y-3">
             <div className="w-12 h-12 bg-primary/10 rounded-full flex items-center justify-center mx-auto">
                <Sprout className="w-6 h-6 text-primary" />
              </div>
              <p className="text-sm font-bold text-on-surface-variant/60">No fields mapped yet</p>
          </div>
        ) : (
          fields.slice(0, 3).map((field, idx) => (
            <div 
              key={field.field_id}
              onClick={() => navigate('/fields')}
              className="p-4 flex items-center gap-4 active:bg-surface-container-lowest transition-colors cursor-pointer"
            >
              <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border-2 border-primary/5 flex-shrink-0 overflow-hidden relative">
                {/* Visual representation of field */}
                <div className="absolute inset-0 opacity-20" style={{ 
                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 5px, currentColor 5px, currentColor 6px)',
                  color: field.health_status === 'healthy' ? '#0d631b' : '#7a5649'
                }} />
                <span className="text-lg font-black text-primary/40 z-10">{idx + 1}</span>
              </div>

              <div className="flex-1 min-w-0">
                <div className="flex justify-between items-start mb-1">
                  <h4 className="font-bold text-base text-on-surface truncate pr-2">{field.field_name}</h4>
                  <span className="text-[10px] font-bold text-on-surface-variant/40 whitespace-nowrap">
                    {field.area_size} {field.area_unit || 'ac'}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={cn(
                    "px-2.5 py-0.5 rounded-lg text-[10px] font-black uppercase tracking-wider",
                    field.health_status === 'healthy' ? "bg-primary/10 text-primary" 
                    : field.health_status === 'attention_needed' ? "bg-amber-100 text-amber-800"
                    : "bg-red-100 text-red-700"
                  )}>
                    {field.health_status === 'healthy' ? 'Healthy' : 'Attention'}
                  </span>
                  <span className="text-[11px] font-medium text-on-surface-variant/60 truncate">
                    {field.active_crop || 'No crop'}
                  </span>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export default function Dashboard() {
  const { t } = useApp();
  const { userProfile, currentUser, loading } = useAuth();
  const navigate = useNavigate();
  const [fields, setFields] = useState<Field[]>([]);
  const [fieldsLoading, setFieldsLoading] = useState(false);

  useEffect(() => {
    if (!currentUser?.uid) return;
    setFieldsLoading(true);
    getUserFields(currentUser.uid)
      .then(setFields)
      .catch(console.error)
      .finally(() => setFieldsLoading(false));
  }, [currentUser?.uid]);

  useEffect(() => {
    if (!loading && !userProfile) {
      navigate('/login');
      return;
    }
  }, [loading, userProfile, navigate]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface">
        <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!userProfile) return null;

  const totalAcres = fields.reduce((acc, f) => acc + (Number(f.area_size) || 0), 0);
  const activeCount = fields.filter(f => f.active_crop).length;

  return (
    <Layout>
      <div className="px-5 space-y-8 pb-10">
        {/* Greeting */}
        <Greeting 
          name={userProfile?.name || 'Farmer'} 
          fieldCount={fields.length}
          totalAcres={totalAcres}
          activeCount={activeCount}
        />

        {/* Weather Card — clickable */}
        <div className="cursor-pointer">
          <Weather />
        </div>

        {/* Summary Stats */}
        <SummaryStats 
          fieldCount={fields.length}
          totalAcres={totalAcres}
          activeCount={activeCount}
        />

        {/* Expert Tools */}
        <section className="space-y-4">
          <h3 className="text-lg font-sans font-extrabold text-on-surface">
            Expert tools
          </h3>

          <div className="grid grid-cols-3 gap-3">
            {[
              { icon: ScanLine, label: 'Disease scan', color: 'bg-red-50 text-red-400', path: '/tools/scan' },
              { icon: CloudSun, label: 'Weather', color: 'bg-blue-50 text-blue-400', path: '/weather' },
              { icon: MapIcon, label: 'Field map', color: 'bg-green-50 text-green-400', path: '/fields' },
              { icon: Sprout, label: 'Crop advice', color: 'bg-green-50 text-green-600', path: '/tools/crops' },
              { icon: Lightbulb, label: 'Daily tips', color: 'bg-amber-50 text-amber-500', path: '/tools' },
              { icon: Mic, label: 'Voice AI', color: 'bg-slate-50 text-slate-400', path: '/voice' },
              { icon: Droplets, label: 'Irrigation', color: 'bg-sky-50 text-sky-500', path: '/irrigation' },
            ].map((tool, i) => (
              <div
                key={i}
                onClick={() => navigate(tool.path)}
                className="bg-white rounded-3xl p-4 flex flex-col gap-6 items-start border border-outline-variant/10 shadow-sm cursor-pointer active:scale-95 transition-transform"
              >
                <div className={cn('w-10 h-10 rounded-xl flex items-center justify-center', tool.color)}>
                  <tool.icon className="w-5 h-5" />
                </div>
                <span className="text-[11px] font-bold text-on-surface leading-tight">
                  {tool.label}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* My Fields */}
        <MyFields fields={fields} />

        {/* Featured Tip */}
        <div className="bg-white rounded-3xl p-6 border border-outline-variant/10 shadow-sm space-y-4">
          <div className="bg-amber-100/50 px-3 py-1 rounded-lg w-fit">
            <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wider">Irrigation</span>
          </div>
          <p className="text-sm font-bold text-on-surface leading-snug">
            AWD Irrigation cuts water 30% on Boro paddy
          </p>
        </div>
      </div>
    </Layout>
  );
}
