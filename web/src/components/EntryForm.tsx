import { useState } from 'react';
import type { FormEvent } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Calendar,
  Eye,
  Moon,
  MoonStar,
  Save,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Sunrise,
  Utensils,
  X,
  Zap,
} from 'lucide-react';
import { RatingStars } from './RatingStars';

interface Ratings {
  spirit: number; energy: number; sleep: number;
  intake: number; symptoms: number; awareness: number; discipline: number;
}

type PartialEntry = { goal?: string; memory?: string } & Partial<Ratings>;

interface EntryFormProps {
  date: string;
  initial?: PartialEntry | null;
  onSave(partial: { goal: string; memory: string } & Ratings): Promise<void>;
  onCancel(): void;
}

const RATING_FIELDS: { key: keyof Ratings; label: string; icon: LucideIcon }[] = [
  { key: 'spirit', label: 'Spirit', icon: Sparkles },
  { key: 'energy', label: 'Energy', icon: Zap },
  { key: 'sleep', label: 'Sleep', icon: MoonStar },
  { key: 'intake', label: 'Intake', icon: Utensils },
  { key: 'symptoms', label: 'Symptoms', icon: Stethoscope },
  { key: 'awareness', label: 'Awareness', icon: Eye },
  { key: 'discipline', label: 'Discipline', icon: ShieldCheck },
];

export const EntryForm = ({ date, initial = null, onSave, onCancel }: EntryFormProps) => {
  const [goal, setGoal] = useState(initial?.goal ?? '');
  const [memory, setMemory] = useState(initial?.memory ?? '');
  const [ratings, setRatings] = useState<Ratings>(() => ({
    spirit: initial?.spirit ?? 0,
    energy: initial?.energy ?? 0,
    sleep: initial?.sleep ?? 0,
    intake: initial?.intake ?? 0,
    symptoms: initial?.symptoms ?? 0,
    awareness: initial?.awareness ?? 0,
    discipline: initial?.discipline ?? 0,
  }));
  const [saving, setSaving] = useState(false);

  const handleSave = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try { await onSave({ goal, memory, ...ratings }); } finally { setSaving(false); }
  };

  return (
    <form onSubmit={handleSave} className="mx-auto max-w-md space-y-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold text-zinc-100">
        <Calendar className="h-4 w-4 text-zinc-400" /> {date}
      </h2>

      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
        <label htmlFor="goal" className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Sunrise className="h-4 w-4 text-amber-400" /> Morning — Goal for the day
        </label>
        <textarea
          id="goal"
          value={goal}
          onChange={(e) => setGoal(e.target.value)}
          rows={3}
          className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
        />
      </div>

      <div className="rounded-lg border border-zinc-700 bg-zinc-900 p-4">
        <label htmlFor="memory" className="mb-1 flex items-center gap-2 text-sm font-medium text-zinc-300">
          <Moon className="h-4 w-4 text-indigo-400" /> Evening — Memory of the day
        </label>
        <textarea
          id="memory"
          value={memory}
          onChange={(e) => setMemory(e.target.value)}
          rows={3}
          className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 text-sm text-zinc-100 focus:border-zinc-500 focus:outline-none"
        />
        <div className="mt-3 space-y-2">
          {RATING_FIELDS.map(({ key, label, icon }) => (
            <RatingStars
              key={key}
              label={label}
              icon={icon}
              value={ratings[key]}
              onChange={(n) => setRatings((r) => ({ ...r, [key]: n }))}
            />
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={saving}
          className="flex flex-1 items-center justify-center gap-2 rounded bg-indigo-600 px-4 py-2 text-white transition-colors duration-150 hover:bg-indigo-700 disabled:opacity-50"
        >
          <Save className="h-4 w-4" /> {saving ? 'Saving…' : 'Save Entry'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="flex flex-1 items-center justify-center gap-2 rounded bg-zinc-800 px-4 py-2 text-zinc-200 transition-colors duration-150 hover:bg-zinc-700"
        >
          <X className="h-4 w-4" /> Cancel
        </button>
      </div>
    </form>
  );
};
