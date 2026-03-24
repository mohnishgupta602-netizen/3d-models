import { useState } from 'react';
import SearchBar from './components/SearchBar';
import ThreeCanvas from './components/ThreeCanvas';
import ModelSelection from './components/ModelSelection';
import AIChatbot from './components/AIChatbot';
import { Layers } from 'lucide-react';

function App() {
  const [isLoading, setIsLoading] = useState(false);
  const [modelData, setModelData] = useState(null);
  const [explodedValue, setExplodedValue] = useState(0);
  const [error, setError] = useState(null);
  const [resultsList, setResultsList] = useState([]);

  const handleSearch = async (query) => {
    setIsLoading(true);
    setError(null);
    setExplodedValue(0);
    setResultsList([]);
    
    try {
      // Parallel intent and search calls
      const [intentRes, searchRes] = await Promise.all([
        fetch('http://127.0.0.1:8000/api/intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        }),
        fetch('http://127.0.0.1:8000/api/search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query })
        })
      ]);

      const [_intentJson, searchJson] = await Promise.all([
        intentRes.json(),
        searchRes.json()
      ]);
      
      if (searchJson.status === 'success' || searchJson.status === 'fallback') {
        const data = Array.isArray(searchJson.data) ? searchJson.data : [searchJson.data];
        setResultsList(data);
        setModelData(data[0]);
      } else {
        throw new Error(searchJson.message || 'Unknown error');
      }
    } catch (err) {
      console.error(err);
      setError('Failed to contact the backend. Ensure it is running on port 8000.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center bg-[#0d1424] overflow-hidden text-slate-100 p-4">
      {/* Header Background Effects */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/5 blur-[120px] rounded-full pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-purple-600/5 blur-[120px] rounded-full pointer-events-none" />

      <header className="w-full max-w-[1400px] flex justify-between items-center mb-6 z-10">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/20">
            <Layers className="text-white w-6 h-6" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">
            Concept3D
          </h1>
        </div>
      </header>

      <main className="w-full max-w-[1440px] flex-grow flex flex-col z-10 relative overflow-hidden">
        {/* Tagline section (now always visible but can shrink) */}
        <div className={`text-center transition-all duration-700 ${modelData ? 'mb-4' : 'mb-8 py-10'}`}>
          <h2 className={`${modelData ? 'text-3xl' : 'text-5xl md:text-6xl'} font-black mb-4 tracking-tighter leading-tight bg-clip-text text-transparent bg-gradient-to-b from-white to-slate-500`}>
            Think it. <span className="text-blue-500">See it.</span> Explore it.
          </h2>
          {!modelData && (
            <p className="text-slate-400 text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
              An intelligent pipeline that bridges abstract text and spatial reality.<br/>
              Enter a concept to generate an interactive 3D model.
            </p>
          )}
        </div>

        <div className="w-full max-w-2xl mx-auto mb-6">
          <SearchBar onSearch={handleSearch} isLoading={isLoading} />
        </div>

        {error && (
          <div className="w-full max-w-2xl mx-auto mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-xl text-red-400 text-center">
            {error}
          </div>
        )}

        {modelData && (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-6 w-full h-[calc(100vh-320px)] animate-in fade-in zoom-in-95 duration-700">
            {/* Left Sidebar: Model Selection */}
            <div className="lg:col-span-1 h-full overflow-hidden">
              <ModelSelection 
                results={resultsList} 
                currentModel={modelData} 
                onSelect={(m) => setModelData(m)} 
              />
            </div>

            {/* Main Canvas: 3D Viewer */}
            <div className="lg:col-span-2 h-full bg-slate-900/40 border border-slate-800/60 rounded-3xl overflow-hidden relative group">
              <ThreeCanvas modelData={modelData} explodedValue={explodedValue} />
              
              {/* Overlay info if needed */}
              <div className="absolute top-4 left-4 p-3 bg-slate-900/80 backdrop-blur rounded-xl border border-slate-800 opacity-0 group-hover:opacity-100 transition-opacity">
                 <h4 className="text-sm font-bold text-slate-100">{modelData.title || 'Selected Model'}</h4>
                 <p className="text-xs text-slate-400">Source: {modelData.source}</p>
              </div>
            </div>

            {/* Right Sidebar: AI Chatbot */}
            <div className="lg:col-span-1 h-full overflow-hidden">
              <AIChatbot />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

export default App;
