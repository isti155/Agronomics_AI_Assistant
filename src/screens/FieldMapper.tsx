import { useState, useEffect, useRef, useCallback } from 'react';
import { useApp } from '../AppContext';
import { useAuth } from '../AuthContext';
import Layout from '../components/Layout';
import { motion, AnimatePresence } from 'motion/react';
import { MapPin, Plus, Trash2, Edit2, CheckCircle, XCircle, Navigation, Undo2, Save, AlertCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  smoothGpsPoint, calculatePolygonArea, computeCentroid, scalePolygon,
  getTileGrid, latLngToPixel, generateGeoHash, formatArea,
  saveDraft, loadDraft, clearDraft, haversineMeters,
  type LatLng, type MapBounds,
} from '../lib/fieldUtils';
import { saveFieldWithPolygon, updateField, deleteField, getUserFields } from '../lib/db';
import type { Field } from '../types';

// CartoDB tiles — free, no API key, no referrer restriction
const TILE_URL = (z: number, x: number, y: number) =>
  `https://a.basemaps.cartocdn.com/rastertiles/voyager/${z}/${x}/${y}.png`;

type Mode = 'list' | 'add-choose' | 'polygon-walk' | 'polygon-review' | 'simple' | 'detail';

function MapCanvas({ center, points, fields, selectedId, onSelectField }: {
  center: LatLng; points: LatLng[]; fields: Field[];
  selectedId?: string; onSelectField?: (f: Field) => void;
}) {
  const { tiles, bounds, gridSize } = getTileGrid(center.lat, center.lng);
  const canvas = { width: gridSize, height: gridSize };
  const toXY = (p: LatLng) => latLngToPixel(p, bounds as MapBounds, canvas);
  const polyPath = (pts: LatLng[]) =>
    pts.map((p, i) => { const {x,y} = toXY(p); return `${i===0?'M':'L'}${x} ${y}`; }).join(' ') + ' Z';
  const scale = 320 / gridSize;
  return (
    <div className="relative rounded-3xl overflow-hidden shadow-lg" style={{ height: 320 }}>
      <div style={{ width: gridSize, height: gridSize, position: 'relative', transform: `scale(${scale})`, transformOrigin: 'top left' }}>
        {tiles.map(t => (
          <img
            key={`${t.tx}-${t.ty}`}
            src={TILE_URL(16, t.tx, t.ty)}
            width={256} height={256} alt=""
            className="absolute"
            style={{ left: t.offsetX, top: t.offsetY }}
          />
        ))}
        <svg className="absolute inset-0" width={gridSize} height={gridSize}>
          {fields.map(f => {
            const sel = f.field_id === selectedId;
            const col = sel ? '#0d631b' : '#2e7d32';
            if (f.input_mode === 'polygon' && f.polygon?.points.length) {
              return <path key={f.field_id} d={polyPath(f.polygon.points)}
                fill={col} fillOpacity={0.35} stroke={col} strokeWidth={4}
                className="cursor-pointer" onClick={() => onSelectField?.(f)} />;
            }
            const {x,y} = toXY({ lat: f.center_point.lat, lng: f.center_point.lng });
            return <circle key={f.field_id} cx={x} cy={y} r={16}
              fill={col} fillOpacity={0.85} stroke="white" strokeWidth={4}
              className="cursor-pointer" onClick={() => onSelectField?.(f)} />;
          })}
          {points.length > 0 && (
            <>
              <path d={polyPath(points)} fill="#0d631b" fillOpacity={0.2}
                stroke="#0d631b" strokeWidth={3} strokeDasharray="8 5" />
              {points.map((p,i) => { const {x,y}=toXY(p); return (
                <circle key={i} cx={x} cy={y} r={12} fill="#0d631b" stroke="white" strokeWidth={3} />
              );})}
            </>
          )}
          {(() => { const {x,y}=toXY(center); return (
            <circle cx={x} cy={y} r={10} fill="#1565c0" stroke="white" strokeWidth={3} />
          );})()}
        </svg>
      </div>
      <div className="absolute bottom-3 right-3 bg-black/50 text-white text-xs px-2 py-1 rounded-lg">
        © OpenStreetMap
      </div>
    </div>
  );
}

export default function FieldMapper() {
  const { t } = useApp();
  const { currentUser } = useAuth();
  const uid = currentUser?.uid ?? '';

  const [mode, setMode] = useState<Mode>('list');
  const [fields, setFields] = useState<Field[]>([]);
  const [selected, setSelected] = useState<Field | null>(null);
  const [points, setPoints] = useState<LatLng[]>([]);
  const [currentPos, setCurrentPos] = useState<LatLng>({ lat: 23.685, lng: 90.356 });
  const [locating, setLocating] = useState(false);
  const [fieldsLoading, setFieldsLoading] = useState(false);
  const [fieldName, setFieldName] = useState('');
  const [areaUnit, setAreaUnit] = useState<'acres'|'hectares'|'bigha'>('acres');
  const [manualArea, setManualArea] = useState('');
  const [simplePoint, setSimplePoint] = useState<LatLng|null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string|null>(null);
  const [editName, setEditName] = useState('');
  const [draftBanner, setDraftBanner] = useState(false);
  const [pendingDraft, setPendingDraft] = useState<ReturnType<typeof loadDraft>>(null);
  const watchRef = useRef<number|null>(null);

  // Load fields (one-time fetch, no live listener — avoids Firestore watch stream bugs)
  const refreshFields = useCallback(async () => {
    if (!uid) return;
    setFieldsLoading(true);
    try {
      const f = await getUserFields(uid);
      setFields(f);
    } catch (err) {
      console.error('[FieldMapper] getUserFields error:', err);
    } finally {
      setFieldsLoading(false);
    }
  }, [uid]);

  useEffect(() => {
    if (!uid) return;
    refreshFields();
    // Check for draft non-blocking (no window.confirm inside effect)
    const draft = loadDraft(uid);
    if (draft?.points.length) {
      setPendingDraft(draft);
      setDraftBanner(true);
    }
  }, [uid, refreshFields]);

  const getPos = useCallback((cb: (p: LatLng) => void) => {
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      pos => { cb({ lat: pos.coords.latitude, lng: pos.coords.longitude }); setLocating(false); },
      () => setLocating(false),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  }, []);

  const startWatch = useCallback(() => {
    if (watchRef.current !== null) return;
    watchRef.current = navigator.geolocation.watchPosition(pos => {
      const raw = { lat: pos.coords.latitude, lng: pos.coords.longitude };
      setCurrentPos(prev => smoothGpsPoint([prev], raw));
    }, undefined, { enableHighAccuracy: true });
  }, []);

  const stopWatch = useCallback(() => {
    if (watchRef.current !== null) {
      navigator.geolocation.clearWatch(watchRef.current);
      watchRef.current = null;
    }
  }, []);

  const markPoint = () => {
    const last = points[points.length - 1];
    if (last && haversineMeters(last, currentPos) < 0.5) return;
    if (points.length >= 50) return;
    const np = [...points, currentPos];
    setPoints(np);
    saveDraft(uid, { points: np, mode: 'polygon', name: fieldName, areaUnit, savedAt: Date.now() });
  };

  const calcArea = () => calculatePolygonArea(points, areaUnit);

  const applyCorrection = () => {
    const t = parseFloat(manualArea);
    if (!isNaN(t) && t > 0) {
      const c = calcArea();
      if (c > 0) setPoints(scalePolygon(points, c, t));
    }
  };

  const savePolygon = async () => {
    if (!uid) { setSaveError('You must be logged in to save fields.'); return; }
    if (!fieldName.trim() || points.length < 3) return;
    setSaving(true); setSaveError(null);
    try {
      const center = computeCentroid(points);
      const area = parseFloat(manualArea) || calcArea();
      await saveFieldWithPolygon(uid, {
        field_name: fieldName.trim(), area_size: area, area_unit: areaUnit,
        geo_hash: generateGeoHash(center.lat, center.lng),
        center_point: { lat: center.lat, lng: center.lng },
        soil_summary: { type: 'Unknown', ph: 7 }, input_mode: 'polygon',
        polygon: { points, calculated_area: calcArea(), area_unit: areaUnit, correction_applied: !!manualArea },
        health_status: 'unknown',
      });
      clearDraft(uid); setPoints([]); setFieldName(''); setManualArea('');
      await refreshFields();
      setMode('list');
    } catch (err: any) {
      console.error('[savePolygon]', err);
      setSaveError(err?.message ?? 'Failed to save. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  const saveSimple = async () => {
    if (!uid) { setSaveError('You must be logged in to save fields.'); return; }
    if (!fieldName.trim() || !simplePoint || !manualArea) return;
    setSaving(true); setSaveError(null);
    try {
      await saveFieldWithPolygon(uid, {
        field_name: fieldName.trim(),
        area_size: parseFloat(manualArea),
        area_unit: areaUnit,
        geo_hash: generateGeoHash(simplePoint.lat, simplePoint.lng),
        center_point: { lat: simplePoint.lat, lng: simplePoint.lng },
        soil_summary: { type: 'Unknown', ph: 7 },
        input_mode: 'simple',
        health_status: 'unknown',
      });
      setFieldName(''); setManualArea(''); setSimplePoint(null);
      await refreshFields();
      setMode('list');
    } catch (err: any) {
      console.error('[saveSimple]', err);
      setSaveError(err?.message ?? 'Failed to save. Check your connection.');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (f: Field) => {
    if (!f.field_id || !window.confirm(`Delete "${f.field_name}"?`)) return;
    try {
      await deleteField(uid, f.field_id);
      await refreshFields();
    } catch (err: any) {
      setSaveError(err?.message ?? 'Delete failed.');
    }
    setSelected(null); setMode('list');
  };

  const handleSaveEdit = async () => {
    if (!selected?.field_id || !editName.trim()) return;
    try {
      await updateField(uid, selected.field_id, { field_name: editName.trim() });
      await refreshFields();
    } catch (err: any) {
      setSaveError(err?.message ?? 'Update failed.');
    }
    setMode('list'); setSelected(null);
  };

  const cancelAdd = () => { stopWatch(); setPoints([]); setFieldName(''); setManualArea(''); setMode('list'); };
  const mapCenter = selected?.center_point
    ? { lat: selected.center_point.lat, lng: selected.center_point.lng }
    : currentPos;

  const inputCls = "w-full bg-surface-container-low rounded-xl px-4 py-3 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-primary/30 border border-outline-variant/20";
  const btnPrimary = "w-full bg-primary text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform disabled:opacity-50";

  return (
    <Layout title={t('fieldMapper')}>
      <div className="px-4 pb-6 space-y-5">
        <div>
          <h2 className="text-2xl font-black text-on-surface">{t('myLand')}</h2>
          <p className="text-sm text-on-surface-variant">{t('manageLand')}</p>
        </div>

        <MapCanvas center={mapCenter} points={points} fields={fields}
          selectedId={selected?.field_id}
          onSelectField={f => { setSelected(f); setEditName(f.field_name); setMode('detail'); }} />

        {/* GPS status bar */}
        {(mode === 'polygon-walk') && (
          <div className="flex items-center justify-between bg-surface-container-low rounded-2xl px-4 py-3">
            <div className="flex items-center gap-2">
              <div className={cn("w-2 h-2 rounded-full", locating ? "bg-orange-400 animate-pulse" : "bg-green-500")} />
              <span className="text-sm font-bold">{locating ? 'Locating…' : 'GPS Active'}</span>
            </div>
            <span className="text-xs text-primary font-black">{points.length} pts</span>
          </div>
        )}

        {/* Save error banner */}
        {saveError && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-red-50 border border-red-200 text-red-700 rounded-2xl px-4 py-3 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-bold text-sm">Save failed</p>
              <p className="text-xs mt-0.5">{saveError}</p>
            </div>
            <button onClick={() => setSaveError(null)} className="text-red-400 hover:text-red-600">
              <XCircle className="w-5 h-5" />
            </button>
          </motion.div>
        )}

        {draftBanner && pendingDraft && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
            className="bg-amber-50 border border-amber-200 text-amber-800 rounded-2xl px-4 py-3">
            <p className="font-bold text-sm">Unsaved draft: {pendingDraft.points.length} GPS points</p>
            <div className="flex gap-2 mt-2">
              <button onClick={() => { setPoints(pendingDraft.points); setFieldName(pendingDraft.name); setAreaUnit(pendingDraft.areaUnit); setMode('polygon-walk'); setDraftBanner(false); }}
                className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-bold">Resume</button>
              <button onClick={() => { clearDraft(uid); setDraftBanner(false); setPendingDraft(null); }}
                className="text-amber-700 px-3 py-1.5 rounded-lg text-xs font-bold border border-amber-300">Discard</button>
            </div>
          </motion.div>
        )}
        {fieldsLoading && (
          <div className="flex items-center gap-2 text-on-surface-variant py-2">
            <div className="w-4 h-4 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
            <span className="text-sm">Loading fields…</span>
          </div>
        )}
        <AnimatePresence mode="wait">

          {mode === 'list' && (
            <motion.div key="list" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-12}} className="space-y-4">
              <button onClick={() => setMode('add-choose')} className={btnPrimary}>
                <Plus className="w-5 h-5" /> Add New Field
              </button>
              {fields.length === 0 && (
                <div className="text-center py-12 text-on-surface-variant">
                  <MapPin className="w-12 h-12 mx-auto mb-3 opacity-20" />
                  <p className="font-bold">No fields yet</p>
                  <p className="text-sm">Add your first field above</p>
                </div>
              )}
              <div className="space-y-3">
                {fields.map(f => (
                  <motion.div key={f.field_id} whileTap={{scale:0.98}}
                    className="bg-surface-container-lowest rounded-2xl p-5 border border-outline-variant/10 editorial-shadow cursor-pointer hover:border-primary/30 transition-all"
                    onClick={() => { setSelected(f); setEditName(f.field_name); setMode('detail'); }}>
                    <div className="flex justify-between items-start">
                      <div>
                        <h4 className="font-bold text-on-surface">{f.field_name}</h4>
                        <p className="text-sm text-on-surface-variant mt-0.5">
                          {formatArea(f.area_size, f.area_unit)} · {f.input_mode === 'polygon' ? 'GPS Mapped' : 'Simple'}
                          {f.input_mode === 'polygon' && f.polygon && ` · ${f.polygon.points.length} pts`}
                        </p>
                      </div>
                      <span className={cn('text-xs font-bold px-2 py-1 rounded-full',
                        f.health_status === 'healthy' ? 'bg-green-100 text-green-800' : 'bg-surface-container text-on-surface-variant')}>
                        {f.health_status || 'unknown'}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}

          {mode === 'add-choose' && (
            <motion.div key="choose" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-12}} className="space-y-4">
              <h3 className="font-black text-lg">Choose mapping mode</h3>
              <motion.button whileTap={{scale:0.97}}
                onClick={() => { setMode('polygon-walk'); startWatch(); getPos(setCurrentPos); }}
                className="w-full bg-primary text-white p-5 rounded-2xl text-left">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-white/20 flex items-center justify-center shrink-0">
                    <Navigation className="w-6 h-6" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">GPS Walk Mode</p>
                    <p className="text-sm opacity-80">Walk your field boundary and tap to mark points</p>
                  </div>
                </div>
              </motion.button>
              <motion.button whileTap={{scale:0.97}}
                onClick={() => { getPos(p => setSimplePoint(p)); setMode('simple'); }}
                className="w-full bg-surface-container-low border border-outline-variant/30 p-5 rounded-2xl text-left">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center shrink-0">
                    <MapPin className="w-6 h-6 text-primary" />
                  </div>
                  <div>
                    <p className="font-bold text-lg">Simple Mode</p>
                    <p className="text-sm text-on-surface-variant">One GPS point + enter area manually</p>
                  </div>
                </div>
              </motion.button>
              <button onClick={cancelAdd} className="w-full text-on-surface-variant py-3 text-sm font-medium">Cancel</button>
            </motion.div>
          )}

          {mode === 'polygon-walk' && (
            <motion.div key="walk" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-12}} className="space-y-4">
              <input value={fieldName} onChange={e => setFieldName(e.target.value)}
                placeholder="Field name (required)" className={inputCls} />
              <div className="flex gap-3">
                <button onClick={markPoint}
                  className="flex-1 bg-primary text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform">
                  <MapPin className="w-5 h-5" /> Mark Point
                </button>
                <button onClick={() => setPoints(p => p.slice(0,-1))} disabled={points.length === 0}
                  className="bg-surface-container-low p-4 rounded-2xl disabled:opacity-40 active:scale-95 transition-transform border border-outline-variant/20">
                  <Undo2 className="w-5 h-5 text-primary" />
                </button>
              </div>
              {points.length >= 3 && (
                <button onClick={() => { stopWatch(); setMode('polygon-review'); }}
                  className="w-full bg-green-600 text-white py-4 rounded-2xl font-bold flex items-center justify-center gap-2 active:scale-95 transition-transform">
                  <CheckCircle className="w-5 h-5" /> Done — Review Field
                </button>
              )}
              {points.length < 3 && points.length > 0 && (
                <p className="text-center text-sm text-on-surface-variant">{3 - points.length} more point{3-points.length!==1?'s':''} needed to close polygon</p>
              )}
              <button onClick={cancelAdd} className="w-full text-on-surface-variant py-2 text-sm">Cancel</button>
            </motion.div>
          )}

          {mode === 'polygon-review' && (
            <motion.div key="review" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-12}} className="space-y-4">
              <div className="bg-surface-container-low rounded-2xl p-5 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-on-surface-variant font-medium">Calculated Area</span>
                  <span className="font-black text-xl text-primary">{formatArea(calcArea(), areaUnit)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-on-surface-variant font-medium">GPS Points</span>
                  <span className="font-bold">{points.length}</span>
                </div>
              </div>
              <select value={areaUnit} onChange={e => setAreaUnit(e.target.value as any)} className={inputCls}>
                <option value="acres">Acres</option>
                <option value="hectares">Hectares</option>
                <option value="bigha">Bigha (বিঘা)</option>
              </select>
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-on-surface-variant">Area Correction (optional)</p>
                <div className="flex gap-2">
                  <input value={manualArea} onChange={e => setManualArea(e.target.value)}
                    placeholder="Actual measured area" type="number" className={`flex-1 ${inputCls.replace('w-full ','')}`} />
                  <button onClick={applyCorrection} disabled={!manualArea}
                    className="bg-tertiary/10 text-tertiary px-4 rounded-xl font-bold text-sm disabled:opacity-40 whitespace-nowrap">
                    Apply Fix
                  </button>
                </div>
                <p className="text-xs text-on-surface-variant">If the calculated area differs from your records, enter the correct value to rescale the polygon.</p>
              </div>
              <button onClick={savePolygon} disabled={saving || !fieldName.trim()}
                className={btnPrimary}>
                <Save className="w-5 h-5" /> {saving ? 'Saving…' : 'Save Field'}
              </button>
              <button onClick={() => { startWatch(); setMode('polygon-walk'); }}
                className="w-full text-on-surface-variant py-2 text-sm">← Back to marking</button>
            </motion.div>
          )}

          {mode === 'simple' && (
            <motion.div key="simple" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-12}} className="space-y-4">
              <h3 className="font-black text-lg">Simple Mode</h3>
              <input value={fieldName} onChange={e => setFieldName(e.target.value)}
                placeholder="Field name" className={inputCls} />
              <div className="bg-surface-container-low rounded-2xl p-4 flex items-center justify-between border border-outline-variant/20">
                <div>
                  <p className="text-xs font-bold uppercase text-on-surface-variant">GPS Point</p>
                  {simplePoint
                    ? <p className="font-bold text-sm text-primary">{simplePoint.lat.toFixed(5)}, {simplePoint.lng.toFixed(5)}</p>
                    : <p className="text-sm text-on-surface-variant">{locating ? 'Detecting…' : 'Not detected'}</p>}
                </div>
                <button onClick={() => getPos(p => setSimplePoint(p))}
                  className="bg-primary/10 text-primary px-3 py-2 rounded-xl text-sm font-bold">
                  <Navigation className="w-4 h-4" />
                </button>
              </div>
              <select value={areaUnit} onChange={e => setAreaUnit(e.target.value as any)} className={inputCls}>
                <option value="acres">Acres</option>
                <option value="hectares">Hectares</option>
                <option value="bigha">Bigha (বিঘা)</option>
              </select>
              <input value={manualArea} onChange={e => setManualArea(e.target.value)}
                placeholder={`Field area in ${areaUnit}`} type="number" className={inputCls} />
              <button onClick={saveSimple} disabled={saving || !fieldName.trim() || !simplePoint || !manualArea}
                className={btnPrimary}>
                <Save className="w-5 h-5" /> {saving ? 'Saving…' : 'Save Field'}
              </button>
              <button onClick={cancelAdd} className="w-full text-on-surface-variant py-2 text-sm">Cancel</button>
            </motion.div>
          )}

          {mode === 'detail' && selected && (
            <motion.div key="detail" initial={{opacity:0,y:12}} animate={{opacity:1,y:0}} exit={{opacity:0,y:-12}}
              className="bg-surface-container-lowest rounded-3xl p-6 border border-outline-variant/10 editorial-shadow space-y-5">
              <div className="flex justify-between items-center">
                <h3 className="text-xl font-black">{selected.field_name}</h3>
                <button onClick={() => { setMode('list'); setSelected(null); }}>
                  <XCircle className="w-6 h-6 text-outline hover:text-primary transition-colors" />
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                {[
                  { label: 'Area', value: formatArea(selected.area_size, selected.area_unit) },
                  { label: 'Mode', value: selected.input_mode === 'polygon' ? 'GPS Mapped' : 'Simple' },
                  { label: 'Status', value: selected.health_status || 'unknown' },
                  { label: 'Points', value: selected.input_mode === 'polygon' ? String(selected.polygon?.points.length ?? 0) : 'N/A' },
                ].map(item => (
                  <div key={item.label} className="bg-surface-container-low p-3 rounded-2xl">
                    <p className="text-xs text-on-surface-variant uppercase font-bold mb-1">{item.label}</p>
                    <p className="font-black capitalize">{item.value}</p>
                  </div>
                ))}
              </div>
              <div className="space-y-2">
                <p className="text-xs font-bold uppercase text-on-surface-variant">Rename</p>
                <div className="flex gap-2">
                  <input value={editName} onChange={e => setEditName(e.target.value)} className={`flex-1 ${inputCls.replace('w-full ','')}`} />
                  <button onClick={handleSaveEdit}
                    className="bg-primary text-white px-4 rounded-xl font-bold flex items-center gap-1">
                    <Edit2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <button onClick={() => handleDelete(selected)}
                className="w-full border-2 border-red-200 text-red-600 py-3 rounded-2xl font-bold flex items-center justify-center gap-2 hover:bg-red-50 transition-colors active:scale-95">
                <Trash2 className="w-4 h-4" /> Delete Field
              </button>
            </motion.div>
          )}

        </AnimatePresence>
      </div>
    </Layout>
  );
}
