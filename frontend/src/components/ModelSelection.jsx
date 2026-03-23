import { Database } from 'lucide-react';

export default function ModelSelection({ results, currentModel, onSelect }) {
  if (!results || results.length === 0) return null;

  return (
    <div className="bg-slate-900/50 border border-slate-800/50 rounded-2xl p-6 shadow-xl backdrop-blur-sm h-full flex flex-col">
      <div className="flex items-center gap-2 mb-6 text-slate-100 font-semibold">
        <Database size={20} className="text-purple-400" />
        <h3 className="text-lg">Model Selection ({results.length})</h3>
      </div>
      
      <div className="flex flex-col gap-3 overflow-y-auto pr-2 custom-scrollbar flex-grow">
        {results.map((res, index) => (
          <button
            key={index}
            onClick={() => onSelect(res)}
            className={`text-left px-4 py-4 rounded-xl border transition-all duration-200 flex flex-col gap-1 group ${
              currentModel?.uid === res.uid 
                ? 'bg-purple-900/30 border-purple-500/50 text-purple-100 shadow-[0_0_15px_rgba(168,85,247,0.15)]' 
                : 'bg-slate-900/30 border-slate-800/80 text-slate-400 hover:bg-slate-800/50 hover:text-slate-200 hover:border-slate-700'
            }`}
          >
            <div className="flex justify-between items-start">
              <span className={`font-bold text-sm ${currentModel?.uid === res.uid ? 'text-purple-300' : 'text-slate-300 group-hover:text-slate-100'}`}>
                {res.source}
              </span>
              {res.score && (
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-500 border border-slate-700">
                  {res.score}%
                </span>
              )}
            </div>
            <span className="text-xs opacity-80 truncate line-clamp-1 italic">{res.title || 'Procedural Model'}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
