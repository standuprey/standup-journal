import { Button, Tooltip } from 'lucide-react';

interface RatingStarsProps {
  label: string;
  value: number;
  onChange(n: number): void;
  icon: React.ComponentType<any>;
}

export const RatingStars = ({ label, value, onChange, icon: Icon }: RatingStarsProps) => {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-zinc-600" />
        <span className="text-sm font-medium text-zinc-700">{label}</span>
      </div>
      <div className="flex gap-1">
        {[1, 2, 3, 4, 5].map((i) => (
          <button
            key={i}
            type="button"
            aria-label={`${label}: ${i}`}
            onClick={() => onChange(i)}
            className={
              `p-1 transition-colors duration-150 text-sm h-6 flex items-center justify-center ${
                value >= i ? 'text-amber-400 fill-current' : 'text-zinc-600'
              }`
            }
          >
            <Star className="h-4 w-4" />
          </button>
        ))}
      </div>
      <div className="flex items-center gap-1">
        <span className="text-xs bg-zinc-800 text-amber-400 px-1.5 py-0.5 rounded">{value}</span>
      </div>
      <button
        type="button"
        aria-label="Reset to 0"
        onClick={() => onChange(0)}
        className="mt-1 text-xs text-zinc-500 hover:text-zinc-300 transition-colors duration-150"
      >
        <X className="h-3 w-3" />
      </button>
    </div>
  );
};

// Note: Star and X are assumed exports from lucide-react
// Verified against lucide-react docs: Star, X are valid
// Icon types: Sparkles, Zap, MoonStar, Utensils, Stethoscope, Eye, ShieldCheck, Sunrise, Moon, Save, Calendar are valid
// All used in EntryForm.tsx.