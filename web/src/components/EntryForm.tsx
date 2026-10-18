import { Button, Tooltip } from 'lucide-react';

interface EntryFormProps {
  onSubmit: (entry: { text: string; rating: number }) => void;
  initialValue?: { text: string; rating: number };
}

export const EntryForm = ({ onSubmit, initialValue = { text: '', rating: 0 } }: EntryFormProps) => {
  const [text, setText] = useState(initialValue.text);
  const [rating, setRating] = useState(initialValue.rating);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ text, rating });
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="entry-text" className="block text-sm font-medium text-zinc-700 mb-1">
          What happened today?
        </label>
        <textarea
          id="entry-text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="w-full p-3 border border-zinc-300 rounded-lg focus:ring-2 focus:ring-zinc-500 focus:border-zinc-500 transition-colors duration-150 text-zinc-900"
          rows={3}
          placeholder="Enter your daily reflection here..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-zinc-700 mb-1">
          How would you rate your day?
        </label>
        <RatingStars 
          label="Day Rating" 
          value={rating} 
          onChange={(newRating) => setRating(newRating)} 
        />
      </div>

      <div className="flex gap-2">
        <Button 
          type="submit" 
          className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition-colors duration-150 flex-1"
        >
          Save Entry
        </Button>
        <Button 
          type="button" 
          variant="secondary" 
          onClick={() => { setText(''); setRating(0); }}
          className="px-4 py-2 bg-zinc-200 hover:bg-zinc-300 text-zinc-700 rounded-lg transition-colors duration-150 flex-1"
        >
          Clear
        </Button>
      </div>
    </form>
  );
};

// Note: RatingStars is assumed to be a component defined elsewhere in the app
// This component will use the RatingStars.tsx implementation provided above
