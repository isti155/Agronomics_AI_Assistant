import { useState, useRef, useEffect, ChangeEvent } from 'react';
import Anthropic from '@anthropic-ai/sdk';
import {
  Camera,
  AlertCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Sprout,
  ThumbsUp,
  ChevronRight,
  Save,
  MapPin,
  ScanLine,
  Zap,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import Layout from '../components/Layout';
import { cn } from '../lib/utils';
import { useAuth } from '../AuthContext';
import { useNavigate } from 'react-router-dom';
import { getUserFields, updateField, getPlantedCrops, saveDiseaseDetectionRecord } from '../lib/db';
import type { PlantedCrop } from '../lib/db';
import type { Field } from '../types';

interface DiagnosisResult {
  disease: string;
  description: string;
  confidence: string;
  treatmentSteps: string[];
  preventionTips: string[];
  severity: 'low' | 'medium' | 'high';
  affectedCrop: string;
  diagnosisCategory?: string;
}

export default function DiseaseDetection() {
  const { currentUser } = useAuth();
  const navigate = useNavigate();
  const uid = currentUser?.uid ?? '';

  const [image, setImage] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<DiagnosisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Field[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string>('');
  const [plantedCrops, setPlantedCrops] = useState<PlantedCrop[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedOk, setSavedOk] = useState(false);
  const [autoSaving, setAutoSaving] = useState(false);
  const [autoSaved, setAutoSaved] = useState(false);
  const imageBlobRef = useRef<Blob | null>(null);
  const [suspectedDisease, setSuspectedDisease] = useState<string>('');
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [correctedDisease, setCorrectedDisease] = useState<string>('');
  const [correcting, setCorrecting] = useState(false);
  const [isCorrected, setIsCorrected] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!uid) return;
    getUserFields(uid).then(setFields).catch(() => {});
  }, [uid]);

  useEffect(() => {
    if (!uid || !selectedFieldId) { setPlantedCrops([]); return; }
    getPlantedCrops(uid)
      .then(all => setPlantedCrops(all.filter(c => c.fieldId === selectedFieldId)))
      .catch(() => {});
  }, [uid, selectedFieldId]);

  const buildFieldContext = (field: Field, crops: PlantedCrop[]): string => {
    const lines = [
      'FIELD CONTEXT (use this to improve diagnosis accuracy):',
      `- Field: "${field.field_name}" (${field.area_size} ${field.area_unit})`,
      `- Soil type: ${field.soil_summary.type}, pH: ${field.soil_summary.ph}`,
    ];
    if (field.active_crop) lines.push(`- Active crop on record: ${field.active_crop}`);
    if (field.health_status && field.health_status !== 'unknown')
      lines.push(`- Current field health: ${field.health_status.replace('_', ' ')}`);
    const growing = crops.filter(c => c.status === 'growing');
    if (growing.length > 0) {
      lines.push('- Ongoing crops:');
      growing.forEach(c => {
        const days = Math.floor((Date.now() - new Date(c.plantedDate).getTime()) / 86400000);
        lines.push(
          `  • ${c.cropName}${c.localName ? ` / ${c.localName}` : ''} — planted ${days} days ago` +
          `${c.expectedHarvestDate ? `, harvest expected ${c.expectedHarvestDate}` : ''}` +
          `${c.notes ? `; notes: ${c.notes}` : ''}`
        );
      });
    }
    const past = crops.filter(c => c.status !== 'growing').slice(0, 4);
    if (past.length > 0) {
      lines.push('- Past crops (history):');
      past.forEach(c => lines.push(`  • ${c.cropName} (${c.status}, planted ${c.plantedDate})`));
    }
    return lines.join('\n');
  };

  const handleImageUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const allowedMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp']);
    if (!allowedMimeTypes.has(file.type)) {
      setImage(null);
      setPrediction(null);
      setSavedOk(false);
      setError('Please upload a valid image file (JPG, PNG, or WEBP).');
      event.target.value = '';
      return;
    }

    setImage(URL.createObjectURL(file));
    setPrediction(null);
    setError(null);
    setSavedOk(false);
    setSuspectedDisease('');
    setCorrectionOpen(false);
    setCorrectedDisease('');
    setIsCorrected(false);
  };

  const analyzeImage = async () => {
    if (!image) return;
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) { setError('Anthropic API key is missing from .env'); return; }

    setLoading(true);
    setError(null);

    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const blob = await fetch(image).then(r => r.blob());
      imageBlobRef.current = blob;
      const base64Data = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve((reader.result as string).split(',')[1]);
        reader.readAsDataURL(blob);
      });

      const selectedField = fields.find((f: Field) => f.field_id === selectedFieldId);
      const fieldContext = selectedField ? buildFieldContext(selectedField, plantedCrops) : '';
      const hintLine = suspectedDisease.trim()
        ? `\nFARMER HINT: The farmer suspects this may be "${suspectedDisease.trim().replace(/"/g, "'")}". Weigh this heavily but rely primarily on the visual evidence from Step 1.\n`
        : '';

      const prompt = `You are an expert plant pathologist and agronomist specializing in Bangladesh crops.
${fieldContext ? `${fieldContext}\n` : ''}${hintLine}
Analyze the leaf image above using this 3-step approach:

STEP 1 — VISUAL CLASSIFICATION (what do you literally see on the leaf?):
  A) Fungal disease — dark sunken spots with concentric rings (Anthracnose), powdery/fluffy coatings, rust pustules, circular lesions with defined margins, spore bodies
  B) Bacterial disease — angular water-soaked lesions bounded by leaf veins, bacterial ooze, wilting without spores
  C) Viral disease — mosaic/mottled colour, distorted leaf shape, yellow vein banding
  D) Insect/pest damage — irregular holes, skeletonization (veins exposed with tissue removed), visible frass, stippling, rolled or webbed leaves
  E) Nutrient deficiency — uniform interveinal chlorosis, tip/margin burn in predictable patterns

STEP 2 — SPECIFIC DIAGNOSIS:
Combine the visual symptoms from Step 1 WITH the field context above (crop type, growth stage, soil, history) to name the most likely specific disease. Field context helps confirm likelihood — e.g. knowing it is jute at 20 days helps distinguish Anthracnose from stem rot — but the visual category from Step 1 must not be overridden by crop-pest stereotypes. If the leaf shows fungal lesions, classify as a fungal disease regardless of what pests the crop typically attracts.

STEP 3 — TREATMENT & PREVENTION:
Use the field context (soil type, crop age, area size, past history) to tailor every treatment step and prevention tip to this specific field.\n
Return ONLY valid JSON in this exact structure:
{
  "diagnosisCategory": "Fungal disease | Bacterial disease | Viral disease | Insect/pest damage | Nutrient deficiency",
  "disease": "Disease name in English and Bengali (e.g. Anthracnose / অ্যানথ্রাকনোজ)",
  "affectedCrop": "Crop name (e.g. Rice, Wheat, Tomato)",
  "description": "2-sentence clinical description referencing the specific visual markers observed in the image",
  "confidence": "88%",
  "severity": "low | medium | high",
  "treatmentSteps": [
    "Step 1: Immediate action with specifics",
    "Step 2: Fungicide/pesticide with specific product name available in Bangladesh",
    "Step 3: Follow-up care tailored to this field",
    "Step 4: Monitoring schedule"
  ],
  "preventionTips": [
    "Prevention measure 1",
    "Prevention measure 2",
    "Prevention measure 3"
  ]
}
If the image is NOT a plant/leaf, return {"error": "Please upload a clear photo of a plant leaf."}`;

      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: blob.type as 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif',
                data: base64Data,
              },
            },
            { type: 'text', text: prompt },
          ],
        }],
      });

      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Invalid AI response format.');
      const data = JSON.parse(match[0]);
      if (data.error) throw new Error(data.error);

      setPrediction(data);

      // Auto-save image + diagnosis to Firebase
      if (uid && imageBlobRef.current) {
        setAutoSaving(true);
        saveDiseaseDetectionRecord(uid, imageBlobRef.current, data, selectedFieldId || undefined)
          .then(_id => setAutoSaved(true))
          .catch(e => console.error('Auto-save detection failed:', e))
          .finally(() => setAutoSaving(false));
      }
    } catch (err: any) {
      const isBusy = err.message?.includes('503') || err.message?.toLowerCase().includes('overloaded');
      setError(isBusy
        ? 'AI is temporarily busy. Please retry in a moment.'
        : err.message || 'Analysis failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSaveToField = async () => {
    if (!uid || !selectedFieldId || !prediction) return;
    setSaving(true);
    try {
      await updateField(uid, selectedFieldId, {
        health_status: prediction.severity === 'high' ? 'critical' : prediction.severity === 'medium' ? 'attention_needed' : 'healthy',
        active_crop: prediction.affectedCrop || undefined,
      });
      setSavedOk(true);
    } catch {
      setError('Could not save to field. Try again.');
    } finally {
      setSaving(false);
    }
  };

  const regenerateTreatmentPlan = async () => {
    if (!correctedDisease.trim() || !prediction) return;
    const apiKey = import.meta.env.VITE_ANTHROPIC_API_KEY;
    if (!apiKey) return;
    setCorrecting(true);
    setError(null);
    const selectedField = fields.find((f: Field) => f.field_id === selectedFieldId);
    const fieldContext = selectedField ? buildFieldContext(selectedField, plantedCrops) : '';
    const correctionPrompt = `You are an expert plant pathologist and agronomist specializing in Bangladesh crops.
The confirmed disease (corrected by the farmer after reviewing visual symptoms) is: "${correctedDisease.trim().replace(/"/g, "'")}"
Affected crop: "${prediction.affectedCrop}"
${fieldContext ? `\n${fieldContext}\n` : ''}
Generate a complete and accurate treatment plan and prevention tips specifically for ${correctedDisease.trim()} on ${prediction.affectedCrop} in Bangladesh.
Tailor the treatment steps to the field conditions above.

Return ONLY valid JSON:
{
  "description": "2-sentence clinical description of ${correctedDisease.trim()} and its spread pattern",
  "severity": "low | medium | high",
  "treatmentSteps": [
    "Step 1: Immediate action",
    "Step 2: Fungicide/pesticide with specific product name available in Bangladesh",
    "Step 3: Follow-up care",
    "Step 4: Monitoring schedule"
  ],
  "preventionTips": [
    "Prevention measure 1",
    "Prevention measure 2",
    "Prevention measure 3"
  ]
}`;
    try {
      const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 2048,
        messages: [{ role: 'user', content: correctionPrompt }],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('Invalid AI response format.');
      const data = JSON.parse(match[0]);
      setPrediction((prev: DiagnosisResult | null) => prev ? {
        ...prev,
        disease: correctedDisease.trim(),
        description: data.description ?? prev.description,
        severity: data.severity ?? prev.severity,
        treatmentSteps: data.treatmentSteps ?? prev.treatmentSteps,
        preventionTips: data.preventionTips ?? prev.preventionTips,
      } : prev);
      setIsCorrected(true);
      setCorrectionOpen(false);
    } catch (err: any) {
      const isBusy = err.message?.includes('503') || err.message?.toLowerCase().includes('overloaded');
      setError(isBusy
        ? 'AI is temporarily busy. Please retry in a moment.'
        : err.message || 'Could not regenerate plan. Try again.');
    } finally {
      setCorrecting(false);
    }
  };

  const severityBadge = {
    low:    'bg-green-100 text-green-700 border-green-200',
    medium: 'bg-amber-100 text-amber-700 border-amber-200',
    high:   'bg-red-100 text-red-700 border-red-200',
  };

  const confidenceNum = parseInt(prediction?.confidence ?? '0') || 0;
  const ringR = 32;
  const ringCirc = 2 * Math.PI * ringR;
  const ringDash = (confidenceNum / 100) * ringCirc;

  const resetScan = () => {
    setImage(null); setPrediction(null); setSavedOk(false);
    setSuspectedDisease(''); setCorrectionOpen(false);
    setCorrectedDisease(''); setIsCorrected(false);
    setAutoSaved(false); imageBlobRef.current = null;
  };

  return (
    <Layout title="Disease scan" showBack>
      <div className="bg-[#f5f5f0] min-h-screen pb-28 space-y-4 px-4 pt-2">

        {/* ── Upload / Image card ── */}
        <motion.div layout className="rounded-3xl overflow-hidden shadow-sm">
          {!image ? (
            /* Empty state */
            <div
              onClick={() => fileInputRef.current?.click()}
              className="bg-[#1a2e1a] aspect-[4/3] flex flex-col items-center justify-center gap-4 cursor-pointer active:opacity-80 transition-opacity"
            >
              <div className="w-16 h-16 rounded-2xl bg-white/10 border-2 border-dashed border-white/30 flex items-center justify-center">
                <Camera className="w-7 h-7 text-white/70" />
              </div>
              <div className="text-center">
                <p className="text-white font-bold text-sm">Upload a leaf photo</p>
                <p className="text-white/50 text-xs mt-0.5">JPG, PNG or WEBP · Focus on affected area</p>
              </div>
              <div className="flex items-center gap-1.5 bg-white/10 px-4 py-2 rounded-full mt-1">
                <ScanLine className="w-3.5 h-3.5 text-white/70" />
                <span className="text-white/70 text-xs font-bold uppercase tracking-wider">VISION AI v2.0</span>
              </div>
            </div>
          ) : (
            /* Image with overlay */
            <div className="relative bg-[#1a2e1a]">
              <div className="aspect-[4/3] relative overflow-hidden">
                <img src={image} className="w-full h-full object-cover opacity-90" alt="Leaf" />

                {/* Scanning overlay */}
                {loading && (
                  <div className="absolute inset-0 bg-[#1a2e1a]/70 backdrop-blur-sm flex flex-col items-center justify-center gap-3">
                    <div className="w-16 h-16 rounded-full border-4 border-primary/30 border-t-primary animate-spin" />
                    <p className="text-white font-bold text-xs uppercase tracking-widest">Analyzing…</p>
                  </div>
                )}

                {/* Lesion badge */}
                {prediction && !loading && (
                  <div className="absolute top-1/3 left-1/2 -translate-x-1/2 -translate-y-1/2">
                    <div className="relative flex items-center justify-center">
                      <div className="w-16 h-16 rounded-full border-2 border-red-400 bg-red-500/20 animate-pulse" />
                      <div className="absolute bg-red-500 text-white text-[10px] font-black px-2 py-0.5 rounded-md -top-6 whitespace-nowrap">
                        LESION {prediction.confidence}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom bar */}
              <div className="flex items-center justify-between px-4 py-3 bg-[#111c11]">
                <div className="flex items-center gap-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
                  <span className="text-white/60 text-[10px] font-bold uppercase tracking-wider">VISION AI v2.0</span>
                </div>
                <div className="flex items-center gap-2">
                  {autoSaving && (
                    <span className="text-white/40 text-[10px] font-bold uppercase tracking-wider">Saving…</span>
                  )}
                  {autoSaved && !autoSaving && (
                    <span className="text-primary text-[10px] font-bold uppercase tracking-wider flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3" /> Saved
                    </span>
                  )}
                  {prediction && (
                    <span className="text-white/60 text-[10px] font-bold uppercase tracking-wider">
                      {prediction.treatmentSteps.length} STEPS
                    </span>
                  )}
                </div>
              </div>

              {/* Action buttons */}
              <div className="px-4 pb-4 pt-2 bg-[#111c11] flex gap-2">
                {!loading && !prediction && (
                  <>
                    <button onClick={resetScan} className="flex-1 py-3 bg-white/10 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-sm active:scale-95 transition-transform">
                      <RefreshCw className="w-4 h-4" /> Retake
                    </button>
                    <button onClick={analyzeImage} className="flex-[2] py-3 bg-primary text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-sm active:scale-95 transition-transform shadow-lg shadow-primary/30">
                      <ScanLine className="w-4 h-4" /> Scan with AI
                    </button>
                  </>
                )}
                {prediction && !loading && (
                  <button onClick={resetScan} className="flex-1 py-3 bg-white/10 text-white font-bold rounded-2xl flex items-center justify-center gap-2 text-sm active:scale-95 transition-transform">
                    <Camera className="w-4 h-4" /> Scan another leaf
                  </button>
                )}
              </div>
            </div>
          )}
          <input type="file" ref={fileInputRef} onChange={handleImageUpload} accept="image/*" className="hidden" />
        </motion.div>

        {/* ── Suspected disease hint (before scan) ── */}
        {image && !prediction && !loading && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-4 border border-outline-variant/10 shadow-sm space-y-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-on-surface-variant/60">
              Suspected Disease <span className="font-normal normal-case">(optional)</span>
            </p>
            <input
              type="text"
              value={suspectedDisease}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setSuspectedDisease(e.target.value)}
              placeholder="e.g. Anthracnose / অ্যানথ্রাকনোজ"
              className="w-full bg-[#f5f5f0] rounded-xl px-4 py-3 text-sm font-medium border border-outline-variant/10 focus:outline-none focus:ring-2 focus:ring-primary/20 placeholder:text-on-surface-variant/30"
            />
          </motion.div>
        )}

        {/* ── Field context (before scan) ── */}
        {uid && fields.length > 0 && !prediction && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-white rounded-3xl p-4 border border-outline-variant/10 shadow-sm space-y-3">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4 text-primary" />
              <span className="text-[10px] font-black uppercase tracking-widest text-primary">Field Context</span>
              <span className="ml-auto text-[10px] text-on-surface-variant/50 font-medium">Optional</span>
            </div>
            <select
              value={selectedFieldId}
              onChange={(e: ChangeEvent<HTMLSelectElement>) => setSelectedFieldId(e.target.value)}
              className="w-full bg-[#f5f5f0] rounded-xl px-4 py-3 text-sm font-bold border border-outline-variant/10 focus:outline-none focus:ring-2 focus:ring-primary/20"
            >
              <option value="">— No field selected —</option>
              {fields.map((f: Field) => (
                <option key={f.field_id} value={f.field_id ?? ''}>{f.field_name}</option>
              ))}
            </select>
            {selectedFieldId && (() => {
              const f = fields.find((x: Field) => x.field_id === selectedFieldId);
              if (!f) return null;
              const growing = plantedCrops.filter((c: PlantedCrop) => c.status === 'growing');
              return (
                <div className="bg-primary/5 rounded-2xl px-4 py-3 space-y-1 text-xs text-on-surface-variant border border-primary/10">
                  <p><span className="font-bold text-on-surface">Soil:</span> {f.soil_summary.type}, pH {f.soil_summary.ph}</p>
                  {f.active_crop && <p><span className="font-bold text-on-surface">Active crop:</span> {f.active_crop}</p>}
                  {growing.length > 0 && (
                    <p><span className="font-bold text-on-surface">Growing:</span> {growing.map((c: PlantedCrop) => `${c.cropName} (${Math.floor((Date.now() - new Date(c.plantedDate).getTime()) / 86400000)}d)`).join(', ')}</p>
                  )}
                </div>
              );
            })()}
          </motion.div>
        )}

        {/* ── Error ── */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="bg-red-50 text-red-700 p-4 rounded-2xl flex gap-3 border border-red-200">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-sm font-bold">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Results ── */}
        <AnimatePresence>
          {prediction && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-4 pb-4">

              {/* ── Diagnosis card ── */}
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-outline-variant/10">

                {/* Top row: label + severity */}
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] font-black uppercase tracking-widest text-primary">Diagnosis</span>
                  <span className={cn('px-3 py-1 rounded-full text-[10px] font-black border', severityBadge[prediction.severity])}>
                    {prediction.severity} severity
                  </span>
                </div>

                {/* Disease name */}
                <h2 className="text-2xl font-black text-on-surface leading-tight">{prediction.disease}</h2>
                <p className="text-primary text-xs font-bold mt-0.5">
                  {prediction.diagnosisCategory || 'Disease'} · {prediction.affectedCrop}
                </p>

                {/* Correction */}
                {!isCorrected && (
                  <button
                    onClick={() => { setCorrectedDisease(prediction.disease); setCorrectionOpen((v: boolean) => !v); }}
                    className="mt-1 text-[11px] text-on-surface-variant/40 underline underline-offset-2"
                  >
                    Incorrect diagnosis?
                  </button>
                )}
                {isCorrected && (
                  <span className="inline-block mt-1 px-2 py-0.5 bg-amber-100 text-amber-800 text-[9px] font-black uppercase tracking-widest rounded-full border border-amber-200">
                    Farmer corrected
                  </span>
                )}

                <AnimatePresence>
                  {correctionOpen && !isCorrected && (
                    <motion.div key="corr" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
                      <div className="mt-3 p-4 bg-amber-50 border border-amber-200 rounded-2xl space-y-3">
                        <p className="text-xs font-bold text-amber-800">Enter the correct disease name:</p>
                        <input
                          type="text"
                          value={correctedDisease}
                          onChange={(e: ChangeEvent<HTMLInputElement>) => setCorrectedDisease(e.target.value)}
                          placeholder="e.g. Anthracnose"
                          className="w-full bg-white rounded-xl px-3 py-2.5 text-sm font-medium border border-amber-300 focus:outline-none focus:ring-2 focus:ring-amber-400/40"
                        />
                        <button
                          onClick={regenerateTreatmentPlan}
                          disabled={correcting || !correctedDisease.trim()}
                          className="w-full py-3 bg-amber-600 text-white font-bold rounded-xl flex items-center justify-center gap-2 disabled:opacity-40 text-sm active:scale-[0.98] transition-transform"
                        >
                          {correcting ? <><Loader2 className="w-4 h-4 animate-spin" /> Regenerating…</> : <><RefreshCw className="w-4 h-4" /> Regenerate Plan</>}
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>

                {/* Confidence ring + description */}
                <div className="flex items-center gap-4 mt-4">
                  <div className="relative flex-shrink-0">
                    <svg width="80" height="80" className="-rotate-90">
                      <circle cx="40" cy="40" r={ringR} fill="none" stroke="#e5e7eb" strokeWidth="7" />
                      <motion.circle
                        cx="40" cy="40" r={ringR}
                        fill="none" stroke="#0d631b" strokeWidth="7"
                        strokeLinecap="round"
                        strokeDasharray={ringCirc}
                        initial={{ strokeDashoffset: ringCirc }}
                        animate={{ strokeDashoffset: ringCirc - ringDash }}
                        transition={{ duration: 1, delay: 0.3, ease: 'easeOut' }}
                      />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center rotate-0">
                      <span className="text-base font-black text-on-surface">{prediction.confidence}</span>
                    </div>
                  </div>
                  <p className="text-xs text-on-surface-variant font-medium leading-relaxed flex-1">
                    {prediction.description}
                  </p>
                </div>
              </div>

              {/* ── Treatment plan ── */}
              <div className="bg-white rounded-3xl p-5 shadow-sm border border-outline-variant/10 space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-black text-base text-on-surface">Treatment plan</h3>
                  <span className="bg-[#f0f0eb] text-on-surface-variant text-[10px] font-black px-2.5 py-1 rounded-full">
                    {prediction.treatmentSteps.length} steps
                  </span>
                </div>

                <div className="space-y-2">
                  {prediction.treatmentSteps.map((step, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -8 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: i * 0.08 }}
                      className="flex gap-3 items-start py-2"
                    >
                      {/* Step marker */}
                      {i === 0 ? (
                        <div className="w-7 h-7 shrink-0 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center mt-0.5">
                          !
                        </div>
                      ) : (
                        <div className="w-7 h-7 shrink-0 rounded-full bg-primary/10 text-primary text-[10px] font-black flex items-center justify-center mt-0.5">
                          {i + 1}
                        </div>
                      )}
                      <p className="text-sm font-medium text-on-surface leading-snug flex-1">
                        {i === 0
                          ? <>{step.replace(/immediately/gi, '')} <span className="font-black text-red-600">immediately</span></>
                          : step}
                      </p>
                    </motion.div>
                  ))}
                </div>
              </div>

              {/* ── Prevention tips ── */}
              <div className="bg-[#f0f7f0] rounded-3xl p-5 border border-green-200/60 space-y-3">
                <h3 className="font-black text-base text-green-800 flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4" /> Prevention Tips
                </h3>
                <ul className="space-y-2">
                  {prediction.preventionTips.map((tip, i) => (
                    <li key={i} className="flex gap-2.5 items-start text-sm text-green-800 font-medium">
                      <ThumbsUp className="w-3.5 h-3.5 shrink-0 mt-0.5 text-green-600" />
                      {tip}
                    </li>
                  ))}
                </ul>
              </div>

              {/* ── Save to field ── */}
              {fields.length > 0 && (
                <div className="bg-white rounded-3xl p-5 shadow-sm border border-outline-variant/10 space-y-3">
                  <h3 className="font-black text-sm flex items-center gap-2">
                    <Sprout className="w-4 h-4 text-primary" /> Update Field Health
                  </h3>
                  <select
                    value={selectedFieldId}
                    onChange={e => setSelectedFieldId(e.target.value)}
                    className="w-full bg-[#f5f5f0] rounded-xl px-4 py-3 text-sm font-bold border border-outline-variant/10 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">— Select a field —</option>
                    {fields.map(f => (
                      <option key={f.field_id} value={f.field_id}>{f.field_name}</option>
                    ))}
                  </select>
                  {savedOk ? (
                    <div className="flex items-center gap-2 text-green-700 font-bold text-sm bg-green-50 p-3 rounded-xl">
                      <CheckCircle2 className="w-4 h-4" /> Field updated successfully!
                    </div>
                  ) : (
                    <button
                      onClick={handleSaveToField}
                      disabled={!selectedFieldId || saving}
                      className="w-full bg-primary text-white py-3.5 rounded-2xl font-bold flex items-center justify-center gap-2 disabled:opacity-40 active:scale-[0.98] transition-transform text-sm"
                    >
                      {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                      {saving ? 'Saving…' : 'Save Health Report'}
                    </button>
                  )}
                </div>
              )}

              {/* ── Crop recommendations link ── */}
              <button
                onClick={() => navigate('/tools/crops')}
                className="w-full flex items-center justify-between bg-white rounded-3xl px-5 py-4 border border-outline-variant/10 shadow-sm active:scale-[0.98] transition-transform"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-primary/10 rounded-2xl flex items-center justify-center">
                    <Sprout className="w-5 h-5 text-primary" />
                  </div>
                  <div className="text-left">
                    <p className="font-bold text-sm text-on-surface">Get Crop Recommendations</p>
                    <p className="text-xs text-on-surface-variant/60">Find disease-resistant crops</p>
                  </div>
                </div>
                <ChevronRight className="w-5 h-5 text-on-surface-variant/30" />
              </button>

            </motion.div>
          )}
        </AnimatePresence>

      </div>
    </Layout>
  );
}
