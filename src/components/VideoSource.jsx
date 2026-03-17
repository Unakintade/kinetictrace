import { useRef, useState } from 'react';
import { Upload, Camera, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export default function VideoSource({ onVideoReady }) {
  const [mode, setMode] = useState(null); // 'upload' | 'webcam'
  const [fileName, setFileName] = useState('');
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setFileName(file.name);
    const url = URL.createObjectURL(file);
    onVideoReady({ type: 'upload', url });
    setMode('upload');
  };

  const startWebcam = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    streamRef.current = stream;
    setMode('webcam');
    onVideoReady({ type: 'webcam', stream });
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    setMode(null);
    onVideoReady(null);
  };

  const clearUpload = () => {
    setMode(null);
    setFileName('');
    if (fileInputRef.current) fileInputRef.current.value = '';
    onVideoReady(null);
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-muted-foreground uppercase tracking-widest font-medium">Video Source</p>
      <div className="flex gap-2">
        <Button
          variant={mode === 'upload' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 gap-2"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="w-3.5 h-3.5" />
          Upload
        </Button>
        <Button
          variant={mode === 'webcam' ? 'default' : 'outline'}
          size="sm"
          className="flex-1 gap-2"
          onClick={mode === 'webcam' ? stopWebcam : startWebcam}
        >
          <Camera className="w-3.5 h-3.5" />
          {mode === 'webcam' ? 'Stop' : 'Webcam'}
        </Button>
      </div>

      {mode === 'upload' && fileName && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-md">
          <span className="text-xs text-primary truncate flex-1">{fileName}</span>
          <button onClick={clearUpload} className="text-muted-foreground hover:text-foreground">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      <input
        ref={fileInputRef}
        type="file"
        accept="video/*"
        className="hidden"
        onChange={handleFileUpload}
      />
    </div>
  );
}