import { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Modality, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { 
  Ship, 
  PawPrint, 
  CloudRain, 
  Rainbow, 
  Play, 
  AlertCircle, 
  Key,
  Download,
  RefreshCw,
  Info,
  Volume2,
  BookOpen,
  Clock,
  CheckCircle2
} from "lucide-react";

// Extend window for AI Studio API
declare global {
  interface Window {
    aistudio: {
      hasSelectedApiKey: () => Promise<boolean>;
      openSelectKey: () => Promise<void>;
    };
  }
}

const LOADING_MESSAGES = [
  "Escribiendo el cuento para los niños...",
  "Preparando la voz del narrador...",
  "Noé está reuniendo la madera...",
  "Los animales están haciendo fila de dos en dos...",
  "Los elefantes traen sus maletas...",
  "Las jirafas estiran sus cuellos para ver el horizonte...",
  "Pintando el arcoíris en el cielo...",
  "Asegurando que el arca no tenga goteras...",
  "Cargando las provisiones para el viaje...",
  "¡Casi listo para la gran aventura!",
];

interface StoryScene {
  text: string;
  videoUrl?: string;
  videoPrompt: string;
}

export default function App() {
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generationStep, setGenerationStep] = useState<string>("");
  const [storyScenes, setStoryScenes] = useState<StoryScene[]>([]);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingMessageIndex, setLoadingMessageIndex] = useState(0);
  const [currentKeyMasked, setCurrentKeyMasked] = useState<string>("");
  const [testStatus, setTestStatus] = useState<{ success?: boolean; message?: string } | null>(null);
  const [currentSceneIndex, setCurrentSceneIndex] = useState(0);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Check for API key on mount
  useEffect(() => {
    const checkKey = async () => {
      if (window.aistudio) {
        const selected = await window.aistudio.hasSelectedApiKey();
        setHasKey(selected);
        
        // Update masked key for debugging
        const apiKey = (window as any).process?.env?.API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
        if (apiKey) {
          setCurrentKeyMasked(apiKey.substring(0, 4) + "..." + apiKey.substring(apiKey.length - 4));
        }
      }
    };
    checkKey();
  }, []);

  const testConnection = async () => {
    setTestStatus({ message: "Testing connection..." });
    try {
      const apiKey = (window as any).process?.env?.API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
      const ai = new GoogleGenAI({ apiKey: apiKey });
      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Say 'Connection Successful!'"
      });
      
      if (response.text) {
        setTestStatus({ success: true, message: "API is working for text! If video fails, it's a video-specific restriction (region or billing tier)." });
      }
    } catch (err: any) {
      console.error("Test error:", err);
      setTestStatus({ success: false, message: `Text API also failed: ${err.message || String(err)}` });
    }
  };

  // Cycle through loading messages
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isGenerating) {
      interval = setInterval(() => {
        setLoadingMessageIndex((prev) => (prev + 1) % LOADING_MESSAGES.length);
      }, 5000);
    }
    return () => clearInterval(interval);
  }, [isGenerating]);

  const handleOpenKeyDialog = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      setHasKey(true); // Assume success as per guidelines
    }
  };

  const generateFullStory = async () => {
    setIsGenerating(true);
    setError(null);
    setStoryScenes([]);
    setAudioUrl(null);
    setCurrentSceneIndex(0);

    try {
      const apiKey = (window as any).process?.env?.API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (!apiKey || apiKey === "undefined") {
        throw new Error("No API Key detected. Please click 'Change API Key'.");
      }

      const ai = new GoogleGenAI({ apiKey: apiKey });

      // STEP 1: Generate Story Script
      setGenerationStep("Escribiendo el cuento...");
      const storyResponse = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: "Escribe un cuento infantil sobre el Arca de Noé que dure unos 3 minutos al ser leído (aprox 450 palabras). Divide el cuento en 4 escenas clave. Para cada escena, proporciona: 1) El texto de la narración. 2) Un prompt visual detallado para generar un video de esa escena (estilo dibujos animados amigables).",
        config: { 
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              scenes: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    text: { type: Type.STRING, description: "El texto de la narración de la escena." },
                    videoPrompt: { type: Type.STRING, description: "El prompt visual detallado para generar un video de esa escena." }
                  },
                  required: ["text", "videoPrompt"]
                }
              }
            },
            required: ["scenes"]
          }
        }
      });

      let jsonText = storyResponse.text || "";
      if (!jsonText) {
        throw new Error("El servidor devolvió una respuesta vacía al escribir el cuento.");
      }

      // Clean up markdown code blocks if they exist
      if (jsonText.includes("```json")) {
        jsonText = jsonText.split("```json")[1].split("```")[0].trim();
      } else if (jsonText.includes("```")) {
        jsonText = jsonText.split("```")[1].split("```")[0].trim();
      }

      let storyData;
      try {
        storyData = JSON.parse(jsonText);
      } catch (e) {
        console.error("JSON Parse Error. Raw text:", jsonText);
        throw new Error("No se pudo procesar el formato del cuento. Por favor, intenta de nuevo.");
      }

      const scenes: StoryScene[] = storyData.scenes;
      if (!scenes || !Array.isArray(scenes) || scenes.length === 0) {
        throw new Error("El cuento generado no tiene el formato correcto.");
      }
      setStoryScenes(scenes);

      // STEP 2: Generate Narration Audio (TTS)
      setGenerationStep("Generando la narración de voz...");
      const fullText = scenes.map(s => s.text).join(" ");
      const ttsResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash-preview-tts",
        contents: [{ parts: [{ text: `Lee este cuento para niños con voz cálida y pausada: ${fullText}` }] }],
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: {
              // 'Puck', 'Charon', 'Kore', 'Fenrir', 'Zephyr'
              prebuiltVoiceConfig: { voiceName: 'Kore' },
            },
          },
        },
      });

      const base64Audio = ttsResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (base64Audio) {
        const audioBlob = await (await fetch(`data:audio/wav;base64,${base64Audio}`)).blob();
        setAudioUrl(URL.createObjectURL(audioBlob));
      } else {
        console.warn("No audio data returned from TTS API.");
        // We can continue without audio, or throw an error. Let's just log it for now.
      }

      // STEP 3: Generate Video Clips
      const updatedScenes = [...scenes];
      for (let i = 0; i < Math.min(scenes.length, 3); i++) {
        setGenerationStep(`Generando video para la escena ${i + 1}...`);
        let operation = await ai.models.generateVideos({
          model: 'veo-3.1-lite-generate-preview',
          prompt: scenes[i].videoPrompt,
          config: {
            numberOfVideos: 1,
            resolution: '720p',
            aspectRatio: '16:9'
          }
        });

        while (!operation.done) {
          await new Promise(resolve => setTimeout(resolve, 10000));
          operation = await ai.operations.getVideosOperation({ operation: operation });
        }

        const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
        if (videoUri) {
          const vResp = await fetch(videoUri, { headers: { 'x-goog-api-key': apiKey } });
          if (!vResp.ok) {
            console.error(`Failed to fetch video ${i+1}: ${vResp.status}`);
            continue;
          }
          const vBlob = await vResp.blob();
          updatedScenes[i].videoUrl = URL.createObjectURL(vBlob);
          setStoryScenes([...updatedScenes]);
        } else {
          console.warn(`No video URI returned for scene ${i+1}.`);
        }
      }

    } catch (err: any) {
      console.error("Story generation error:", err);
      setError(err.message || "Ocurrió un error al generar el cuento.");
    } finally {
      setIsGenerating(false);
      setGenerationStep("");
    }
  };

  const resetKey = async () => {
    if (window.aistudio) {
      await window.aistudio.openSelectKey();
      // The state will be updated by the next check or assumed success
      setHasKey(true);
      setError(null);
      
      // Update masked key
      const apiKey = (window as any).process?.env?.API_KEY || process.env.API_KEY || process.env.GEMINI_API_KEY;
      if (apiKey) {
        setCurrentKeyMasked(apiKey.substring(0, 4) + "..." + apiKey.substring(apiKey.length - 4));
      }
    }
  };

  return (
    <div className="min-h-screen bg-sky-50 flex flex-col items-center p-4 md:p-8 font-sans">
      {/* Header */}
      <header className="w-full max-w-4xl text-center mb-8">
        <motion.div
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          className="inline-block p-4 bg-white rounded-full shadow-lg mb-4"
        >
          <Ship className="w-12 h-12 text-amber-600" />
        </motion.div>
        <motion.h1 
          className="text-4xl md:text-5xl font-bold text-slate-800 mb-2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
        >
          El Arca de Noé: Cuentos Animados
        </motion.h1>
        <p className="text-slate-600 text-lg">Un viaje mágico narrado para los más pequeños</p>
      </header>

      <main className="w-full max-w-5xl bg-white rounded-[2.5rem] shadow-2xl border-8 border-white overflow-hidden relative">
        <div className="p-6 md:p-10">
          <AnimatePresence mode="wait">
            {!hasKey ? (
              <motion.div key="auth" className="text-center py-12">
                <Key className="w-16 h-16 text-amber-400 mx-auto mb-6" />
                <h2 className="text-2xl font-bold mb-4 text-slate-800">Configuración Necesaria</h2>
                <p className="text-slate-600 mb-8 max-w-md mx-auto">
                  Para crear cuentos animados, necesitamos conectar con la inteligencia de Gemini.
                </p>
                <button
                  onClick={handleOpenKeyDialog}
                  className="bg-amber-500 hover:bg-amber-600 text-white font-bold py-4 px-10 rounded-full shadow-xl transition-all active:scale-95"
                >
                  Configurar Clave API
                </button>
              </motion.div>
            ) : isGenerating ? (
              <motion.div key="loading" className="text-center py-20">
                <div className="relative w-40 h-40 mx-auto mb-10">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                    className="absolute inset-0 border-[12px] border-sky-100 border-t-sky-500 rounded-full shadow-inner"
                  />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <motion.div
                      animate={{ y: [0, -10, 0] }}
                      transition={{ duration: 2, repeat: Infinity }}
                    >
                      <Ship className="w-16 h-16 text-amber-500" />
                    </motion.div>
                  </div>
                </div>
                <h2 className="text-3xl font-bold text-slate-800 mb-4">{generationStep}</h2>
                <p className="text-xl text-sky-600 font-medium italic animate-pulse">
                  "{LOADING_MESSAGES[loadingMessageIndex]}"
                </p>
                <div className="mt-12 max-w-md mx-auto bg-sky-50 rounded-full h-4 overflow-hidden border border-sky-100">
                  <motion.div 
                    className="h-full bg-sky-500"
                    animate={{ width: ["0%", "100%"] }}
                    transition={{ duration: 180, ease: "linear" }}
                  />
                </div>
                <p className="text-sm text-slate-400 mt-4">Esto puede tardar unos minutos. ¡La espera valdrá la pena!</p>
              </motion.div>
            ) : storyScenes.length > 0 ? (
              <motion.div key="player" className="w-full">
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Video Player Section */}
                  <div className="lg:col-span-2">
                    <div className="aspect-video bg-slate-900 rounded-3xl overflow-hidden shadow-2xl border-4 border-slate-800 relative group">
                      {storyScenes[currentSceneIndex]?.videoUrl ? (
                        <video 
                          key={storyScenes[currentSceneIndex].videoUrl}
                          src={storyScenes[currentSceneIndex].videoUrl} 
                          autoPlay 
                          loop 
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-4">
                          <div className="w-20 h-20 border-4 border-slate-700 border-t-amber-500 rounded-full animate-spin" />
                          <p>Cargando visuales de la escena...</p>
                        </div>
                      )}
                      
                      {/* Scene Overlay */}
                      <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent text-white">
                        <div className="flex items-center gap-3 mb-2">
                          <span className="bg-amber-500 text-xs font-bold px-2 py-1 rounded">ESCENA {currentSceneIndex + 1}</span>
                        </div>
                        <p className="text-lg font-medium leading-relaxed">
                          {storyScenes[currentSceneIndex].text}
                        </p>
                      </div>
                    </div>

                    {/* Audio Controls */}
                    <div className="mt-6 bg-sky-50 p-6 rounded-3xl flex items-center gap-6 shadow-inner">
                      {audioUrl && (
                        <audio 
                          ref={audioRef}
                          src={audioUrl} 
                          onTimeUpdate={(e) => {
                            // Simple logic to switch scenes based on audio progress
                            const audio = e.currentTarget;
                            const progress = audio.currentTime / audio.duration;
                            const newIndex = Math.min(
                              Math.floor(progress * storyScenes.length),
                              storyScenes.length - 1
                            );
                            if (newIndex !== currentSceneIndex) setCurrentSceneIndex(newIndex);
                          }}
                        />
                      )}
                      <button 
                        onClick={() => audioRef.current?.paused ? audioRef.current.play() : audioRef.current?.pause()}
                        className="w-16 h-16 bg-amber-500 hover:bg-amber-600 text-white rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90"
                      >
                        <Volume2 className="w-8 h-8" />
                      </button>
                      <div className="flex-1">
                        <div className="flex justify-between text-xs font-bold text-sky-700 mb-2 uppercase tracking-wider">
                          <span>Narración en curso</span>
                          <span>{storyScenes.length} Escenas</span>
                        </div>
                        <div className="h-3 bg-sky-200 rounded-full overflow-hidden">
                          <motion.div 
                            className="h-full bg-sky-600"
                            style={{ width: `${((currentSceneIndex + 1) / storyScenes.length) * 100}%` }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Sidebar / Story Info */}
                  <div className="flex flex-col gap-6">
                    <div className="bg-amber-50 p-6 rounded-3xl border-2 border-amber-100">
                      <h3 className="text-xl font-bold text-amber-800 mb-4 flex items-center gap-2">
                        <BookOpen className="w-5 h-5" />
                        Guía del Cuento
                      </h3>
                      <div className="space-y-4">
                        {storyScenes.map((scene, idx) => (
                          <button
                            key={idx}
                            onClick={() => setCurrentSceneIndex(idx)}
                            className={`w-full text-left p-3 rounded-xl transition-all flex items-center gap-3 ${
                              currentSceneIndex === idx 
                                ? 'bg-white shadow-md border-l-4 border-amber-500 text-amber-900' 
                                : 'text-slate-500 hover:bg-white/50'
                            }`}
                          >
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                              currentSceneIndex === idx ? 'bg-amber-500 text-white' : 'bg-slate-200'
                            }`}>
                              {idx + 1}
                            </div>
                            <span className="text-sm font-medium line-clamp-1">{scene.text}</span>
                          </button>
                        ))}
                      </div>
                    </div>

                    <button
                      onClick={generateFullStory}
                      className="w-full bg-white border-4 border-sky-100 hover:border-sky-200 text-sky-600 font-bold py-4 rounded-3xl flex items-center justify-center gap-2 transition-all shadow-sm"
                    >
                      <RefreshCw className="w-5 h-5" />
                      Crear Otro Cuento
                    </button>
                  </div>
                </div>
              </motion.div>
            ) : (
              <motion.div key="start" className="text-center py-12">
                <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
                  {[
                    { icon: PawPrint, label: "Animales", color: "bg-orange-100 text-orange-600" },
                    { icon: Volume2, label: "Narrado", color: "bg-blue-100 text-blue-600" },
                    { icon: Clock, label: "3 Minutos", color: "bg-purple-100 text-purple-600" },
                    { icon: CheckCircle2, label: "Educativo", color: "bg-green-100 text-green-600" },
                  ].map((item, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className="flex flex-col items-center"
                    >
                      <div className={`w-20 h-20 rounded-[2rem] flex items-center justify-center mb-3 shadow-sm ${item.color}`}>
                        <item.icon className="w-10 h-10" />
                      </div>
                      <span className="font-bold text-slate-700">{item.label}</span>
                    </motion.div>
                  ))}
                </div>

                <button
                  onClick={generateFullStory}
                  className="group relative bg-amber-500 hover:bg-amber-600 text-white font-bold py-8 px-16 rounded-full shadow-2xl transition-all active:scale-95 text-2xl flex items-center gap-4 mx-auto overflow-hidden"
                >
                  <Play className="w-10 h-10 fill-current" />
                  ¡Empezar el Cuento!
                  <motion.div 
                    className="absolute inset-0 bg-white/20"
                    animate={{ x: ['-100%', '200%'] }}
                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                  />
                </button>

                {error && (
                  <div className="mt-10 p-6 bg-red-50 border-2 border-red-100 rounded-3xl max-w-2xl mx-auto flex flex-col items-center gap-4">
                    <div className="flex items-center gap-3 text-red-600 font-bold">
                      <AlertCircle className="w-6 h-6" />
                      Error de Generación
                    </div>
                    <p className="text-red-500 text-sm whitespace-pre-wrap text-left">{error}</p>
                    <button onClick={resetKey} className="text-amber-600 font-bold underline text-sm">Cambiar Clave API</button>
                    <div className="flex flex-col items-center gap-2 mt-2">
                      <button onClick={testConnection} className="text-xs text-slate-400 underline">Probar Conexión</button>
                      {testStatus && <p className="text-[10px] text-slate-500">{testStatus.message}</p>}
                    </div>
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      <footer className="mt-12 text-slate-400 text-sm flex flex-col items-center gap-4">
        <div className="flex gap-6">
          <PawPrint className="w-5 h-5" />
          <Ship className="w-5 h-5" />
          <Rainbow className="w-5 h-5" />
        </div>
        <p>© 2026 Cuentos de Noé • Inteligencia Artificial para Niños</p>
      </footer>
    </div>
  );
}
