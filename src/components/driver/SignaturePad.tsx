import { useRef, useState, useEffect, useLayoutEffect, useCallback } from 'react';
import { useAuthStore } from '../../stores/authStore';
import { useDriverStore } from '../../stores/driverStore';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function SignaturePad() {
  const { isRTL } = useAuthStore();
  const { setSignature, setPickupState } = useDriverStore();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasSignature, setHasSignature] = useState(false);
  // Synchronous mirror of hasSignature for the resize handler below — the
  // handler is registered once (empty dep array) and reads this ref rather
  // than the stale `hasSignature` it closed over.
  const hasSignatureRef = useRef(false);

  useEffect(() => {
    hasSignatureRef.current = hasSignature;
  }, [hasSignature]);

  // Sizes the canvas's actual drawing buffer to match its rendered CSS size
  // × devicePixelRatio, then scales the context so all drawing coordinates
  // stay in CSS-pixel units. Without this, a canvas with fixed width/height
  // HTML attributes (e.g. 600×300) stretched to 100% CSS width diverges from
  // its drawing-buffer space at any width other than 600px — at 375px the
  // drawn line visibly lags the finger by ~1.6x.
  //
  // Setting canvas.width/height CLEARS the drawing buffer — so this must
  // never run while a signature is already in progress (e.g. an
  // orientation change or virtual-keyboard-triggered viewport resize mid-
  // signature would otherwise silently erase what the user just drew).
  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || hasSignatureRef.current) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);

    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    ctx.strokeStyle = '#000';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
  }, []);

  useLayoutEffect(() => {
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    window.addEventListener('orientationchange', resizeCanvas);
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('orientationchange', resizeCanvas);
    };
  }, [resizeCanvas]);

  const startDrawing = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    setIsDrawing(true);
    setHasSignature(true);

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.beginPath();
    ctx.moveTo(x, y);
  };

  const draw = (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const x = 'touches' in e ? e.touches[0].clientX - rect.left : e.clientX - rect.left;
    const y = 'touches' in e ? e.touches[0].clientY - rect.top : e.clientY - rect.top;

    ctx.lineTo(x, y);
    ctx.stroke();
  };

  const stopDrawing = () => {
    setIsDrawing(false);
  };

  const clearSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // clearRect works in the current (post-scale) transform space, i.e. CSS
    // pixels — use the CSS-rendered size, not canvas.width/height (device
    // pixels), or this only clears a fraction of the visible area on a
    // high-DPI screen.
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    setHasSignature(false);
    hasSignatureRef.current = false;
    // Catch up on any resize that arrived while a signature was in progress
    // and therefore skipped (see resizeCanvas) — now safe, nothing to lose.
    resizeCanvas();
  };

  const confirmSignature = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const signatureData = canvas.toDataURL();
    setSignature(signatureData);
    setPickupState('confirmation');
  };

  return (
    <div className="space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold text-foreground mb-2">
          {isRTL ? 'التوقيع' : 'Signature'}
        </h1>
        <p className="text-muted-foreground">
          {isRTL ? 'يطلب توقيع مسؤول المنشأة' : 'Facility manager signature required'}
        </p>
      </div>

      <Card className="bg-card text-card-foreground border-border">
        <CardHeader>
          <CardTitle className="text-foreground">
            {isRTL ? 'الرجاء التوقيع أدناه' : 'Please sign below'}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="border-2 border-border rounded-lg overflow-hidden bg-background">
            <canvas
              ref={canvasRef}
              // No width/height attributes — resizeCanvas() sets the actual
              // drawing-buffer size from this CSS size × devicePixelRatio.
              // Leaving fixed HTML attributes here would fight it (React
              // re-applies them, clobbering the buffer, on every re-render).
              className="w-full h-[300px] block touch-none cursor-crosshair"
              onMouseDown={startDrawing}
              onMouseMove={draw}
              onMouseUp={stopDrawing}
              onMouseLeave={stopDrawing}
              onTouchStart={startDrawing}
              onTouchMove={draw}
              onTouchEnd={stopDrawing}
            />
          </div>

          <div className="flex gap-3 sticky bottom-20 lg:bottom-4 z-30 bg-background/95 backdrop-blur-sm rounded-xl pt-2">
            <Button
              variant="outline"
              onClick={clearSignature}
              className="flex-1 h-12 bg-background text-foreground border-border hover:bg-accent hover:text-accent-foreground"
            >
              {isRTL ? 'إعادة' : 'Clear'}
            </Button>
            <Button
              onClick={confirmSignature}
              disabled={!hasSignature}
              className="flex-1 h-12 text-base bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {isRTL ? 'تأكيد التوقيع' : 'Confirm Signature'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
