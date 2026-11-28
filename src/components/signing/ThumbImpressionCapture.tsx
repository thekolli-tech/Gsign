import React, { useRef, useState, useEffect } from 'react';
import { Upload, RotateCcw, Fingerprint, AlertCircle } from 'lucide-react';
import { validateThumbImageFile } from '../../utils/biometricSigning';

export interface CapturedThumbImpression {
  data_url: string;
  thumb_type: 'left' | 'right';
  capture_mode: 'touch_canvas' | 'image_upload';
  mime_type: 'image/png' | 'image/jpeg';
}

interface ThumbImpressionCaptureProps {
  value: CapturedThumbImpression | null;
  onChange: (val: CapturedThumbImpression | null) => void;
}

export const ThumbImpressionCapture: React.FC<ThumbImpressionCaptureProps> = ({ value, onChange }) => {
  const [thumbType, setThumbType] = useState<'left' | 'right'>(value?.thumb_type || 'right');
  const [mode, setMode] = useState<'touch_canvas' | 'image_upload'>(value?.capture_mode || 'touch_canvas');
  const [isDrawing, setIsDrawing] = useState(false);
  const [hasDrawn, setHasDrawn] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [rawImageUrl, setRawImageUrl] = useState<string | null>(null);
  const [zoomScale, setZoomScale] = useState(1);
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (mode === 'touch_canvas' && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
      }
    }
  }, [mode]);

  const emitCanvas = (nextThumbType: 'left' | 'right' = thumbType) => {
    if (!canvasRef.current) return;
    onChange({
      data_url: canvasRef.current.toDataURL('image/png'),
      thumb_type: nextThumbType,
      capture_mode: 'touch_canvas',
      mime_type: 'image/png',
    });
  };

  const startDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const rect = canvas.getBoundingClientRect();
    setIsDrawing(true);
    setHasDrawn(true);
    ctx.beginPath();
    ctx.moveTo(e.clientX - rect.left, e.clientY - rect.top);
  };

  const moveDraw = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !canvasRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;
    const rect = canvasRef.current.getBoundingClientRect();
    ctx.lineTo(e.clientX - rect.left, e.clientY - rect.top);
    ctx.stroke();
  };

  const endDraw = () => {
    if (!isDrawing) return;
    setIsDrawing(false);
    emitCanvas();
  };

  const clearCanvas = () => {
    if (canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      }
    }
    setHasDrawn(false);
    onChange(null);
  };

  const renderCroppedUpload = (
    srcUrl: string,
    scale: number,
    ox: number,
    oy: number,
    nextThumbType: 'left' | 'right' = thumbType,
  ) => {
    const img = new Image();
    img.onload = () => {
      const out = document.createElement('canvas');
      out.width = 240;
      out.height = 180;
      const ctx = out.getContext('2d');
      if (!ctx) return;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, out.width, out.height);
      const fitScale = Math.min(out.width / img.width, out.height / img.height) * scale;
      const drawW = img.width * fitScale;
      const drawH = img.height * fitScale;
      const dx = (out.width - drawW) / 2 + ox;
      const dy = (out.height - drawH) / 2 + oy;
      ctx.drawImage(img, dx, dy, drawW, drawH);
      const exported = out.toDataURL('image/png');
      if (exported.length > 500_000) {
        setUploadError('Processed thumb impression image exceeds 500KB limit.');
        onChange(null);
        return;
      }
      onChange({
        data_url: exported,
        thumb_type: nextThumbType,
        capture_mode: 'image_upload',
        mime_type: 'image/png',
      });
    };
    img.src = srcUrl;
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    setUploadError(null);
    if (!file) return;

    const basicCheck = validateThumbImageFile({ name: file.name, type: file.type, size: file.size });
    if (!basicCheck.valid) {
      setUploadError(basicCheck.error || 'Unsupported file.');
      onChange(null);
      e.target.value = '';
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result || '');
      const img = new Image();
      img.onload = () => {
        const dimCheck = validateThumbImageFile({
          name: file.name,
          type: file.type,
          size: file.size,
          width: img.width,
          height: img.height,
        });
        if (!dimCheck.valid) {
          setUploadError(dimCheck.error || 'Invalid image dimensions.');
          onChange(null);
          return;
        }
        setRawImageUrl(dataUrl);
        setZoomScale(1);
        setOffsetX(0);
        setOffsetY(0);
        renderCroppedUpload(dataUrl, 1, 0, 0);
      };
      img.onerror = () => {
        setUploadError('Could not decode uploaded image file.');
        onChange(null);
      };
      img.src = dataUrl;
    };
    reader.onerror = () => {
      setUploadError('Could not read uploaded image file.');
      onChange(null);
    };
    reader.readAsDataURL(file);
  };

  return (
    <div className="space-y-3 p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-950/40">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-800 dark:text-slate-200">
          <Fingerprint size={14} className="text-brand-600" />
          <span>Digital Thumb Impression</span>
        </div>

        <div className="flex items-center gap-1 text-[11px]">
          {(['left', 'right'] as const).map((side) => (
            <button
              key={side}
              type="button"
              onClick={() => {
                setThumbType(side);
                if (value) {
                  onChange({ ...value, thumb_type: side });
                }
              }}
              className={`px-2 py-0.5 rounded border font-medium capitalize ${
                thumbType === side
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
              }`}
            >
              {side} Thumb
            </button>
          ))}
        </div>
      </div>

      {/* Mode Tabs */}
      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
        <button
          type="button"
          onClick={() => {
            setMode('touch_canvas');
            setUploadError(null);
          }}
          className={`py-1.5 rounded-md border font-medium ${
            mode === 'touch_canvas'
              ? 'bg-white dark:bg-slate-900 border-brand-600 text-brand-700 dark:text-brand-300'
              : 'border-slate-200 dark:border-slate-800 text-slate-500'
          }`}
        >
          Touchscreen Capture
        </button>
        <button
          type="button"
          onClick={() => setMode('image_upload')}
          className={`py-1.5 rounded-md border font-medium ${
            mode === 'image_upload'
              ? 'bg-white dark:bg-slate-900 border-brand-600 text-brand-700 dark:text-brand-300'
              : 'border-slate-200 dark:border-slate-800 text-slate-500'
          }`}
        >
          Upload PNG / JPEG
        </button>
      </div>

      {mode === 'touch_canvas' ? (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span>Capture {thumbType} thumb impression below</span>
            <button
              type="button"
              onClick={clearCanvas}
              className="inline-flex items-center gap-1 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            >
              <RotateCcw size={10} />
              Clear
            </button>
          </div>
          <div className="relative rounded-lg border border-dashed border-brand-400 bg-white overflow-hidden">
            <canvas
              ref={canvasRef}
              width={280}
              height={130}
              onPointerDown={startDraw}
              onPointerMove={moveDraw}
              onPointerUp={endDraw}
              onPointerLeave={endDraw}
              className="w-full h-32 touch-none cursor-crosshair"
            />
            {!hasDrawn && (
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-[11px] text-slate-400">
                Draw {thumbType} thumb impression with finger or stylus
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-300 cursor-pointer hover:border-brand-500">
            <Upload size={13} />
            <span>Choose PNG or JPEG (max 2MB)</span>
            <input
              type="file"
              accept="image/png,image/jpeg"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>

          {uploadError && (
            <div className="flex items-center gap-1.5 text-[11px] text-rose-600 dark:text-rose-400">
              <AlertCircle size={12} />
              <span>{uploadError}</span>
            </div>
          )}

          {rawImageUrl && value?.data_url && (
            <div className="space-y-2">
              <div className="flex items-center justify-center bg-white border border-slate-200 rounded-lg p-2">
                <img src={value.data_url} alt={`${thumbType} thumb preview`} className="h-24 object-contain" />
              </div>
              <div className="grid grid-cols-3 gap-2 text-[10px] text-slate-500">
                <label>
                  Zoom ({zoomScale.toFixed(1)}x)
                  <input
                    type="range"
                    min="0.6"
                    max="2"
                    step="0.1"
                    value={zoomScale}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setZoomScale(next);
                      renderCroppedUpload(rawImageUrl, next, offsetX, offsetY);
                    }}
                    className="w-full"
                  />
                </label>
                <label>
                  Pos X
                  <input
                    type="range"
                    min="-40"
                    max="40"
                    value={offsetX}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setOffsetX(next);
                      renderCroppedUpload(rawImageUrl, zoomScale, next, offsetY);
                    }}
                    className="w-full"
                  />
                </label>
                <label>
                  Pos Y
                  <input
                    type="range"
                    min="-40"
                    max="40"
                    value={offsetY}
                    onChange={(e) => {
                      const next = Number(e.target.value);
                      setOffsetY(next);
                      renderCroppedUpload(rawImageUrl, zoomScale, offsetX, next);
                    }}
                    className="w-full"
                  />
                </label>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal">
        <strong>Notice:</strong> This is a manually captured digital thumb impression for document execution. It does not perform biometric fingerprint matching or prove identity.
      </p>
    </div>
  );
};
