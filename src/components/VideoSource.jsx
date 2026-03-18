import { useRef } from 'react';
import { Upload, Camera, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/SessionContext';

export default function VideoSource() {
  const { videoSource, videoName, loadVideo, clearVideo, loadWebcam } = useSession();
  const fileInputRef = useRef(null);
  const streamRef = useRef(null);

  const mode = videoSource?.type ?? null;

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    loadVideo(file);
  };

  const startWebcam = async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    streamRef.current = stream;
    loadWebcam(stream);
  };

  const stopWebcam = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    clearVideo();
  };

  const clearUpload = () => {
    if (fileInputRef.current) fileInputRef.current.value = '';
    clearVideo();
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

      {mode === 'upload' && videoName && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 border border-primary/20 rounded-md">
          <span className="text-xs text-primary truncate flex-1">{videoName}</span>
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