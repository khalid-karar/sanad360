import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { CameraIcon, XIcon, RotateCcwIcon, CheckIcon, CheckCircle2Icon } from 'lucide-react';

/**
 * Evidence-integrity camera capture: getUserMedia (rear camera) → live
 * preview → canvas frame grab → File. No gallery/file-picker path exists
 * while getUserMedia is available — a staged/pre-existing image cannot be
 * uploaded as pickup/receipt/weighbridge evidence through this component.
 *
 * Fallback (getUserMedia unavailable, permission denied, insecure context,
 * or no camera): a native `<input type="file" accept="image/*"
 * capture="environment">`. Where the browser/OS honors `capture`, this still
 * opens the camera app directly rather than the gallery. Desktop browsers
 * ignore `capture` and show a normal file dialog — the explicitly-allowed
 * "may keep a file fallback for testing" case, not a gallery bypass on
 * mobile.
 *
 * MANUAL VERIFICATION (no jsdom/RTL in this repo's test setup — see
 * vite.config.ts test.environment: 'node' — so this is not covered by an
 * automated component test; verify by hand):
 *   1. Mobile browser, camera permission ALLOWED: tapping the button opens
 *      a live rear-camera preview (not the OS gallery/file picker) with
 *      Capture / Cancel; after Capture, Retake / Use Photo; "Use Photo"
 *      calls onCapture with a real image/jpeg File.
 *   2. Mobile browser, camera permission DENIED (or a device with no
 *      camera): tapping the button falls back to the OS camera app via
 *      `capture="environment"` — NOT the gallery.
 *   3. Desktop browser (no getUserMedia support assumed, or after denying):
 *      falls back to a normal file picker (expected desktop-testing path).
 *   4. Component unmounts while the camera is open (e.g. navigating away
 *      mid-capture): the MediaStream's tracks are stopped (check the
 *      browser's camera-in-use indicator turns off) — no leaked camera lock.
 */

interface CameraCaptureProps {
  isRTL: boolean;
  /** Trigger button label before anything is captured. */
  label: string;
  /** Trigger button label once capturedFile is set (mirrors existing "✓ captured" style). */
  capturedLabel: string;
  capturedFile?: File;
  onCapture: (file: File) => void;
  /** Used to build the produced File's name: `${fileNameBase}-${timestamp}.jpg`. */
  fileNameBase?: string;
}

export default function CameraCapture({
  isRTL, label, capturedLabel, capturedFile, onCapture, fileNameBase = 'capture',
}: CameraCaptureProps) {
  const [open, setOpen] = useState(false);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const hasGetUserMedia =
    typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;

  function stopStream() {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }

  // Never leave the camera locked on if the component unmounts mid-capture.
  useEffect(() => () => stopStream(), []);

  async function openCamera() {
    if (!hasGetUserMedia) {
      fileInputRef.current?.click();
      return;
    }
    setOpen(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
    } catch {
      // Permission denied / no camera / insecure context — fall back rather
      // than leaving the user stuck on a dead camera screen.
      setOpen(false);
      fileInputRef.current?.click();
    }
  }

  function closeCamera() {
    stopStream();
    setOpen(false);
    setPreviewBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
  }

  function shoot() {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob((blob) => {
      if (!blob) return;
      setPreviewBlob(blob);
      setPreviewUrl(URL.createObjectURL(blob));
      stopStream();
    }, 'image/jpeg', 0.9);
  }

  function retake() {
    setPreviewBlob(null);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    void openCamera();
  }

  function confirmCapture() {
    if (!previewBlob) return;
    const file = new File([previewBlob], `${fileNameBase}-${Date.now()}.jpg`, { type: 'image/jpeg' });
    onCapture(file);
    closeCamera();
  }

  function handleFileFallback(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
    e.target.value = '';
  }

  return (
    <>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={handleFileFallback}
      />
      <Button
        type="button"
        variant="outline"
        onClick={openCamera}
        className={`w-full gap-2 ${capturedFile ? 'border-success text-success' : 'bg-background text-foreground border-border'}`}
      >
        {capturedFile
          ? <><CheckCircle2Icon className="w-4 h-4" />{capturedLabel}</>
          : <><CameraIcon className="w-4 h-4" />{label}</>}
      </Button>

      {open && (
        <div className="fixed inset-0 z-[100] bg-black flex flex-col items-center justify-center p-4">
          <canvas ref={canvasRef} className="hidden" />
          {!previewUrl ? (
            <>
              <video ref={videoRef} playsInline muted className="max-w-full max-h-[75vh] rounded-md" />
              <div className="flex items-center gap-4 mt-6">
                <Button type="button" variant="outline" onClick={closeCamera} className="gap-2">
                  <XIcon className="w-4 h-4" />{isRTL ? 'إلغاء' : 'Cancel'}
                </Button>
                <Button type="button" onClick={shoot} size="lg" className="gap-2">
                  <CameraIcon className="w-5 h-5" />{isRTL ? 'التقاط' : 'Capture'}
                </Button>
              </div>
            </>
          ) : (
            <>
              <img src={previewUrl} alt="" className="max-w-full max-h-[75vh] rounded-md" />
              <div className="flex items-center gap-4 mt-6">
                <Button type="button" variant="outline" onClick={retake} className="gap-2">
                  <RotateCcwIcon className="w-4 h-4" />{isRTL ? 'إعادة الالتقاط' : 'Retake'}
                </Button>
                <Button type="button" onClick={confirmCapture} size="lg" className="gap-2">
                  <CheckIcon className="w-5 h-5" />{isRTL ? 'استخدام الصورة' : 'Use Photo'}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}
