import React, { useState, useEffect, useRef, useMemo } from 'react';
import { createRoot } from 'react-dom/client';
import { 
  Play, 
  Pause, 
  RotateCcw, 
  Upload, 
  Settings, 
  BookOpen, 
  Zap,
  ChevronLeft,
  ChevronRight,
  Clipboard,
  X,
  FileText,
  Trash2,
  AlertCircle,
  Loader2,
  Globe,
  Check,
  Clock,
  Download,
  Sun,
  ShieldAlert,
  Hash,
  ArrowRight
} from 'lucide-react';
import { TRANSLATIONS } from './translations';
import { decodeBuffer, parseEpub, parseMobi, parseMobiZip } from './parsers';

const STORAGE_KEYS = {
  TEXT: 'swiftread_text_v3',
  INDEX: 'swiftread_index_v3',
  WPM: 'swiftread_wpm_v3',
  FONT_SIZE: 'swiftread_font_size_v3',
  LANG: 'swiftread_lang_v3'
};

const App = () => {
  const [lang, setLang] = useState<'cs' | 'en'>('cs');
  const [text, setText] = useState<string>('');
  const [tempText, setTempText] = useState<string>('');
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [wpm, setWpm] = useState<number>(250);
  const [fontSize, setFontSize] = useState<number>(48);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isSetupOpen, setIsSetupOpen] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isWakeLockActive, setIsWakeLockActive] = useState<boolean>(false);
  const [wakeLockSupported, setWakeLockSupported] = useState<boolean>('wakeLock' in navigator);
  const [jumpInputValue, setJumpInputValue] = useState<string>('');

  const t = TRANSLATIONS[lang];
  const timerRef = useRef<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const wakeLockRef = useRef<any>(null);

  // Persistence Loading
  useEffect(() => {
    const savedLang = localStorage.getItem(STORAGE_KEYS.LANG) as 'cs' | 'en';
    const savedText = localStorage.getItem(STORAGE_KEYS.TEXT);
    const savedIndex = parseInt(localStorage.getItem(STORAGE_KEYS.INDEX) || '0', 10);
    const savedWpm = parseInt(localStorage.getItem(STORAGE_KEYS.WPM) || '250', 10);
    const savedFontSize = parseInt(localStorage.getItem(STORAGE_KEYS.FONT_SIZE) || '48', 10);

    if (savedLang) setLang(savedLang);
    
    const initialContent = savedText || TRANSLATIONS[savedLang || 'cs'].initialText;
    setText(initialContent);
    setTempText(initialContent);
    setCurrentIndex(savedIndex);
    setWpm(Math.max(50, savedWpm));
    setFontSize(savedFontSize);

    if (!savedText) {
      setIsSetupOpen(true);
    }
  }, []);

  // Persistence Saving
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.LANG, lang); }, [lang]);
  useEffect(() => { if (text) localStorage.setItem(STORAGE_KEYS.TEXT, text); }, [text]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.INDEX, currentIndex.toString()); }, [currentIndex]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.WPM, wpm.toString()); }, [wpm]);
  useEffect(() => { localStorage.setItem(STORAGE_KEYS.FONT_SIZE, fontSize.toString()); }, [fontSize]);

  const requestWakeLock = async () => {
    if ('wakeLock' in navigator) {
      try {
        wakeLockRef.current = await (navigator as any).wakeLock.request('screen');
        setIsWakeLockActive(true);
        wakeLockRef.current.addEventListener('release', () => {
          setIsWakeLockActive(false);
          wakeLockRef.current = null;
        });
      } catch (err) {
        console.warn(`Wake Lock request failed: ${err}`);
        setIsWakeLockActive(false);
      }
    }
  };

  const releaseWakeLock = async () => {
    if (wakeLockRef.current) {
      try {
        await wakeLockRef.current.release();
      } catch(e) {}
      wakeLockRef.current = null;
      setIsWakeLockActive(false);
    }
  };

  const togglePlay = async () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);
    
    if (nextState) {
      await requestWakeLock();
    } else {
      await releaseWakeLock();
    }
  };

  useEffect(() => {
    const handleVisibilityChange = async () => {
      if (document.visibilityState === 'visible' && isPlaying) {
        await requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
  }, [isPlaying]);

  const words = useMemo(() => {
    // Rozdělení textu a ošetření "slovo.slovo"
    const processedText = text.replace(/([\p{L}\p{N}])\.([\p{L}\p{N}])/gu, '$1. $2');
    return processedText.split(/\s+/).filter(w => w.length > 0);
  }, [text]);

  const estimatedTimeRemaining = useMemo(() => {
    const wordsLeft = Math.max(0, words.length - currentIndex);
    const totalSeconds = (wordsLeft / wpm) * 60;
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = Math.floor(totalSeconds % 60);
    
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes === 0 && seconds === 0) return "0s";
    if (minutes === 0) return `${seconds}s`;
    return `${minutes}m ${seconds}s`;
  }, [words.length, currentIndex, wpm]);

  // RSVP Engine
  useEffect(() => {
    if (isPlaying && currentIndex < words.length) {
      const msPerWord = (60 / wpm) * 1000;
      let delay = msPerWord;
      const currentWord = words[currentIndex];
      
      if (/[.!?]$/.test(currentWord)) {
        delay *= 2.0;
      } else if (/[,;:]$/.test(currentWord)) {
        delay *= 1.5;
      } else if (currentWord.length > 10) {
        delay *= 1.3;
      }

      timerRef.current = window.setTimeout(() => {
        setCurrentIndex(prev => prev + 1);
      }, delay);
    } else if (currentIndex >= words.length && words.length > 0) {
      setIsPlaying(false);
      releaseWakeLock();
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [isPlaying, currentIndex, wpm, words]);

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSetupOpen) return;
      if (e.code === 'Space') {
        e.preventDefault();
        togglePlay();
      } else if (e.code === 'ArrowLeft') {
        setCurrentIndex(prev => Math.max(0, prev - 1));
        setIsPlaying(false);
        releaseWakeLock();
      } else if (e.code === 'ArrowRight') {
        setCurrentIndex(prev => Math.min(words.length - 1, prev + 1));
        setIsPlaying(false);
        releaseWakeLock();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSetupOpen, words.length, isPlaying]);

  const handleJump = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const val = parseInt(jumpInputValue, 10);
    if (!isNaN(val)) {
      const targetIndex = Math.max(0, Math.min(words.length - 1, val));
      setCurrentIndex(targetIndex);
      setIsPlaying(false);
      releaseWakeLock();
      setJumpInputValue('');
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setErrorMsg(null);
    try {
      const buffer = await file.arrayBuffer();
      let extractedText = "";

      const name = file.name.toLowerCase();
      if (name.endsWith('.epub')) {
        extractedText = await parseEpub(buffer);
      } else if (name.endsWith('.mobi')) {
        extractedText = await parseMobi(buffer);
      } else if (name.endsWith('.mobi.zip') || name.endsWith('.zip')) {
        extractedText = await parseMobiZip(buffer);
      } else if (name.endsWith('.json')) {
        const jsonContent = JSON.parse(decodeBuffer(buffer));
        if (jsonContent.type === 'swiftread_backup') {
          setText(jsonContent.text);
          setTempText(jsonContent.text);
          setCurrentIndex(jsonContent.currentIndex);
          setWpm(jsonContent.wpm);
          setFontSize(jsonContent.fontSize);
          setIsProcessing(false);
          setIsSetupOpen(false);
          return;
        } else {
          throw new Error("Invalid format");
        }
      } else {
        extractedText = decodeBuffer(buffer);
      }

      if (!extractedText.trim()) throw new Error("Empty text");
      setTempText(extractedText);
    } catch (err) {
      setErrorMsg(t.errorFile);
      setTimeout(() => setErrorMsg(null), 5000);
    } finally {
      setIsProcessing(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExport = () => {
    const backupData = {
      type: 'swiftread_backup',
      version: 3,
      text: text,
      currentIndex: currentIndex,
      wpm: wpm,
      fontSize: fontSize,
      timestamp: Date.now()
    };
    const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `swiftread_progress_${new Date().toISOString().split('T')[0]}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePaste = async () => {
    setErrorMsg(null);
    try {
      if (navigator.clipboard && navigator.clipboard.readText) {
        const clip = await navigator.clipboard.readText();
        if (clip) setTempText(clip);
        else setErrorMsg(t.errorClipboardEmpty);
      } else {
        setErrorMsg(t.errorClipboardDenied);
      }
    } catch (err) {
      setErrorMsg(t.errorClipboardDenied);
      setTimeout(() => setErrorMsg(null), 4000);
    }
  };

  const handleApplyText = () => {
    if (tempText.trim()) {
      if (tempText.trim() !== text.trim()) {
        setCurrentIndex(0);
      }
      setText(tempText);
      setIsSetupOpen(false);
      setIsPlaying(false);
      releaseWakeLock();
    }
  };

  const renderWord = (word: string) => {
    if (!word) return null;
    let orpIndex = 0;
    if (word.length <= 1) orpIndex = 0;
    else if (word.length <= 5) orpIndex = 1;
    else if (word.length <= 9) orpIndex = 2;
    else orpIndex = 3;

    const before = word.substring(0, orpIndex);
    const focus = word.charAt(orpIndex);
    const after = word.substring(orpIndex + 1);

    return (
      <div 
        className="flex justify-center items-center font-mono font-bold tracking-tight whitespace-nowrap" 
        style={{ fontSize: `${fontSize}px` }}
      >
        <div className="w-[45vw] text-right opacity-30 overflow-hidden text-ellipsis">{before}</div>
        <div className="text-rose-500 min-w-[0.6em] text-center px-0.5">{focus}</div>
        <div className="w-[45vw] text-left opacity-30 overflow-hidden text-ellipsis">{after}</div>
      </div>
    );
  };

  const progress = words.length > 0 ? (currentIndex / words.length) * 100 : 0;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center p-4 sm:p-8 select-none overflow-x-hidden">
      <header className="w-full max-w-4xl flex justify-between items-center mb-8 border-b border-slate-800 pb-4 shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-rose-500 rounded-xl shadow-lg shadow-rose-900/20">
            <Zap size={22} className="text-white fill-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tighter uppercase leading-none">SwiftRead</h1>
            <span className="text-[10px] text-slate-500 font-mono tracking-widest uppercase">{t.subtitle}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isWakeLockActive && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 rounded-xl animate-pulse" title={t.wakeLockActive}>
              <Sun size={14} />
              <span className="text-[10px] font-bold uppercase tracking-tight hidden sm:inline">{t.wakeLockActive}</span>
            </div>
          )}
          <button 
            onClick={() => setLang(lang === 'cs' ? 'en' : 'cs')}
            className="p-2 hover:bg-slate-800 rounded-xl transition-all flex items-center gap-2 text-xs text-slate-400 border border-slate-800"
          >
            <Globe size={16} />
            <span className="uppercase font-bold">{lang}</span>
          </button>
          <button 
            onClick={() => { setTempText(text); setIsSetupOpen(true); setIsPlaying(false); releaseWakeLock(); }}
            className="px-4 py-2 hover:bg-slate-800 rounded-xl transition-all flex items-center gap-2 text-sm text-slate-300 border border-transparent hover:border-slate-700"
          >
            <Settings size={18} />
            <span className="hidden sm:inline">{t.settings}</span>
          </button>
        </div>
      </header>

      <main className="flex-1 w-full max-w-5xl flex flex-col justify-center items-center relative py-12">
        <div className="w-full h-48 sm:h-72 bg-slate-900/30 rounded-[3rem] border border-slate-800/50 shadow-2xl flex flex-col items-center justify-center relative mb-12 overflow-hidden backdrop-blur-sm group">
          <div className="absolute top-0 bottom-0 left-1/2 -translate-x-1/2 w-px bg-rose-500/10 pointer-events-none group-hover:bg-rose-500/20 transition-colors"></div>
          <div className="transition-all duration-75 transform scale-100">
            {currentIndex < words.length ? (
              renderWord(words[currentIndex])
            ) : (
              <div className="text-slate-500 flex flex-col items-center gap-4 animate-in fade-in zoom-in duration-300">
                <div className="p-4 bg-slate-800/50 rounded-full">
                  <BookOpen size={40} className="opacity-20" />
                </div>
                <div className="text-center">
                  <p className="font-bold uppercase tracking-[0.2em] text-xs mb-1">{t.done}</p>
                  <p className="text-[10px] opacity-50 uppercase tracking-widest">{t.doneSubtitle}</p>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="w-full max-w-4xl space-y-12">
          {/* Progress Section */}
          <div className="w-full">
            <div className="flex flex-col sm:flex-row justify-between items-center sm:items-end mb-4 px-1 gap-4">
              <div className="flex flex-col items-center sm:items-start space-y-1 w-full sm:w-1/3">
                <span className="block text-[10px] text-slate-500 font-mono uppercase tracking-widest">{t.position}</span>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-bold font-mono whitespace-nowrap">
                    {currentIndex} / {words.length} <span className="text-slate-500 font-normal">{t.words}</span>
                  </span>
                  
                  {/* Jump Feature */}
                  <form onSubmit={handleJump} className="flex items-center bg-slate-900 rounded-lg border border-slate-800 overflow-hidden">
                    <div className="px-2 text-slate-600">
                      <Hash size={12} />
                    </div>
                    <input 
                      type="number" 
                      placeholder="0"
                      value={jumpInputValue}
                      onChange={(e) => setJumpInputValue(e.target.value)}
                      className="w-16 bg-transparent py-1 text-xs font-mono outline-none border-none text-slate-300 placeholder:text-slate-700"
                    />
                    <button type="submit" className="p-1.5 hover:bg-slate-800 text-rose-500 transition-colors">
                      <ArrowRight size={12} />
                    </button>
                  </form>
                </div>
              </div>
              
              <div className="flex flex-col items-center space-y-1 w-full sm:w-1/3">
                 <div className="flex items-center gap-2 text-rose-400 bg-rose-500/10 px-3 py-1 rounded-full border border-rose-500/20">
                    <Clock size={12} />
                    <span className="text-[10px] font-bold font-mono uppercase tracking-tight whitespace-nowrap">{t.timeFinish}: {estimatedTimeRemaining}</span>
                 </div>
              </div>

              <div className="flex flex-col items-center sm:items-end space-y-1 w-full sm:w-1/3">
                <span className="block text-[10px] text-slate-500 font-mono uppercase tracking-widest">{t.progress}</span>
                <span className="text-sm font-bold font-mono text-rose-400">{Math.round(progress)}%</span>
              </div>
            </div>
            <div 
              className="h-2.5 w-full bg-slate-900 rounded-full overflow-hidden border border-slate-800/50 cursor-pointer group"
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const x = e.clientX - rect.left;
                const percentage = x / rect.width;
                setCurrentIndex(Math.floor(percentage * words.length));
              }}
            >
              <div 
                className="h-full bg-gradient-to-r from-rose-600 to-rose-400 transition-all duration-300 rounded-full shadow-[0_0_15px_rgba(244,63,94,0.3)]"
                style={{ width: `${progress}%` }}
              ></div>
            </div>
          </div>

          {/* Main Controls */}
          <div className="flex flex-col sm:flex-row items-center justify-between gap-8 bg-slate-900/20 p-6 rounded-[2rem] border border-slate-800/30">
            <div className="flex items-center gap-4">
              <button 
                onClick={() => { setCurrentIndex(0); setIsPlaying(false); releaseWakeLock(); }}
                className="p-3 bg-slate-900 hover:bg-slate-800 rounded-2xl border border-slate-800 transition-all text-slate-400 hover:text-white"
                title={t.reset}
              >
                <RotateCcw size={20} />
              </button>
              <div className="flex items-center bg-slate-900 rounded-2xl border border-slate-800 p-1">
                <button 
                  onClick={() => { setCurrentIndex(prev => Math.max(0, prev - 1)); setIsPlaying(false); releaseWakeLock(); }}
                  className="p-3 hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-white"
                >
                  <ChevronLeft size={24} />
                </button>
                <button 
                  onClick={togglePlay}
                  className="w-16 h-12 flex items-center justify-center bg-rose-500 hover:bg-rose-400 rounded-xl shadow-lg shadow-rose-900/20 transition-all group"
                >
                  {isPlaying ? <Pause size={24} className="fill-white" /> : <Play size={24} className="ml-1 fill-white" />}
                </button>
                <button 
                  onClick={() => { setCurrentIndex(prev => Math.min(words.length - 1, prev + 1)); setIsPlaying(false); releaseWakeLock(); }}
                  className="p-3 hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-white"
                >
                  <ChevronRight size={24} />
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-center gap-8 w-full sm:w-auto">
              <div className="w-full sm:w-48 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">{t.speed}</span>
                  <span className="text-xs font-bold font-mono text-rose-400">{wpm} WPM</span>
                </div>
                <input 
                  type="range" min="50" max="1500" step="10" value={wpm}
                  onChange={(e) => setWpm(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-rose-500"
                />
              </div>

              <div className="w-full sm:w-32 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">{t.fontSize}</span>
                  <span className="text-xs font-bold font-mono text-rose-400">{fontSize}px</span>
                </div>
                <input 
                  type="range" min="20" max="150" step="2" value={fontSize}
                  onChange={(e) => setFontSize(parseInt(e.target.value))}
                  className="w-full h-1.5 bg-slate-800 rounded-full appearance-none cursor-pointer accent-rose-500"
                />
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Setup Modal */}
      {isSetupOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-xl animate-in fade-in duration-300 overflow-y-auto">
          <div className="my-auto w-full max-w-3xl bg-slate-900 border border-slate-800 rounded-[2.5rem] shadow-2xl overflow-hidden flex flex-col max-h-[95vh] sm:max-h-[90vh]">
            <header className="p-6 sm:p-8 flex justify-between items-center border-b border-slate-800 shrink-0">
              <div className="flex items-center gap-4">
                <div className="p-2.5 bg-slate-800 rounded-2xl text-rose-500">
                  <Settings size={20} />
                </div>
                <div>
                  <h2 className="text-xl font-bold tracking-tight">{t.modalTitle}</h2>
                  <p className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">{t.editor}</p>
                </div>
              </div>
              <button 
                onClick={() => setIsSetupOpen(false)}
                className="p-2 hover:bg-slate-800 rounded-xl transition-all text-slate-500 hover:text-white"
              >
                <X size={24} />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar">
              <div className="space-y-6">
                <div className="relative group">
                  <textarea 
                    value={tempText}
                    onChange={(e) => setTempText(e.target.value)}
                    placeholder={t.placeholder}
                    className="w-full h-64 sm:h-80 bg-slate-950 border border-slate-800 rounded-3xl p-6 text-sm focus:ring-2 focus:ring-rose-500/20 focus:border-rose-500/50 outline-none transition-all resize-none font-mono leading-relaxed"
                  />
                  <div className="absolute top-4 right-4 flex flex-col gap-2">
                    <button 
                      onClick={handlePaste}
                      className="p-3 bg-slate-900/80 backdrop-blur border border-slate-800 hover:border-slate-700 hover:bg-slate-800 rounded-2xl transition-all text-slate-400 hover:text-rose-400 flex items-center gap-2 group/btn"
                    >
                      <Clipboard size={18} />
                      <span className="text-[10px] font-bold uppercase tracking-widest hidden group-hover/btn:inline">{t.paste}</span>
                    </button>
                    <button 
                      onClick={() => setTempText('')}
                      className="p-3 bg-slate-900/80 backdrop-blur border border-slate-800 hover:border-slate-700 hover:bg-slate-800 rounded-2xl transition-all text-slate-400 hover:text-rose-600 flex items-center gap-2 group/btn"
                    >
                      <Trash2 size={18} />
                      <span className="text-[10px] font-bold uppercase tracking-widest hidden group-hover/btn:inline">{t.clear}</span>
                    </button>
                  </div>
                </div>

                {errorMsg && (
                  <div className="flex items-center gap-3 p-4 bg-rose-500/10 border border-rose-500/20 rounded-2xl text-rose-400 text-xs animate-in slide-in-from-top-2">
                    <AlertCircle size={16} />
                    {errorMsg}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div 
                    onClick={() => fileInputRef.current?.click()}
                    className="group relative flex flex-col items-center justify-center p-8 border-2 border-dashed border-slate-800 hover:border-rose-500/30 hover:bg-rose-500/5 rounded-3xl transition-all cursor-pointer overflow-hidden"
                  >
                    <input 
                      type="file" ref={fileInputRef} onChange={handleFileUpload}
                      className="hidden" accept=".txt,.epub,.mobi,.zip,.json"
                    />
                    {isProcessing ? (
                      <Loader2 size={32} className="text-rose-500 animate-spin mb-4" />
                    ) : (
                      <Upload size={32} className="text-slate-600 group-hover:text-rose-400 transition-colors mb-4" />
                    )}
                    <span className="text-sm font-bold mb-1">{isProcessing ? t.processing : t.upload}</span>
                    <span className="text-[10px] text-slate-500 font-mono uppercase tracking-widest">{t.uploadFormats}</span>
                  </div>

                  <div className="flex flex-col justify-center p-8 bg-slate-800/30 border border-slate-800 rounded-3xl">
                    <div className="flex items-center gap-3 text-slate-400 mb-4">
                      <FileText size={20} />
                      <span className="text-xs font-bold uppercase tracking-widest">{t.stats}</span>
                    </div>
                    <div className="space-y-1">
                      <span className="text-2xl font-bold font-mono text-rose-400">
                        {tempText.split(/\s+/).filter(w => w.length > 0).length}
                      </span>
                      <span className="block text-[10px] text-slate-500 font-mono uppercase tracking-widest">{t.totalWords}</span>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-slate-800/50 rounded-2xl border border-slate-700 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Sun size={18} className={wakeLockSupported ? "text-yellow-500" : "text-slate-500"} />
                    <div className="flex flex-col">
                      <span className="text-xs font-bold uppercase tracking-tight">Prevence spánku</span>
                      <span className="text-[10px] text-slate-500">Wake Lock API Status</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {wakeLockSupported ? (
                      <div className="flex items-center gap-2 px-2 py-1 bg-emerald-500/10 text-emerald-500 rounded-lg border border-emerald-500/20">
                        <Check size={12} />
                        <span className="text-[10px] font-bold uppercase">Podporováno</span>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 px-2 py-1 bg-rose-500/10 text-rose-500 rounded-lg border border-rose-500/20">
                        <ShieldAlert size={12} />
                        <span className="text-[10px] font-bold uppercase">Nepodporováno</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <footer className="p-6 sm:p-8 border-t border-slate-800 bg-slate-900/50 flex flex-col sm:flex-row gap-4 shrink-0">
              <button 
                onClick={handleExport}
                className="flex-1 py-4 bg-slate-800 hover:bg-slate-700 rounded-2xl font-bold flex items-center justify-center gap-3 transition-all text-slate-300 group border border-slate-700"
              >
                <Download size={20} className="group-hover:translate-y-0.5 transition-transform" />
                {t.export}
              </button>
              <button 
                onClick={handleApplyText}
                disabled={!tempText.trim() || isProcessing}
                className="flex-[2] py-4 bg-rose-500 hover:bg-rose-400 disabled:opacity-50 disabled:hover:bg-rose-500 rounded-2xl font-bold flex items-center justify-center gap-3 shadow-lg shadow-rose-900/20 transition-all text-white group"
              >
                {isProcessing ? <Loader2 className="animate-spin" size={20} /> : <Check size={20} />}
                {t.confirm}
              </button>
            </footer>
          </div>
        </div>
      )}

      <footer className="w-full max-w-4xl mt-12 py-6 border-t border-slate-900 flex justify-between items-center text-[10px] text-slate-600 font-mono uppercase tracking-[0.2em]">
        <span>&copy; 2024 SwiftRead Pro</span>
        <div className="flex gap-4">
          <span>{wpm} WPM</span>
          <span className="text-rose-900/40">/</span>
          <span>{fontSize}PX</span>
        </div>
      </footer>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);