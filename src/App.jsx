import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  FileImage,
  FolderOpen,
  ImageDown,
  Info,
  Maximize2,
  PanelTopOpen,
  Pipette,
  RotateCcw,
  SlidersHorizontal,
  Upload,
  X,
} from 'lucide-react';
import { decodeGb7, encodeGb7, imageHasTransparency } from './utils/gb7.js';
import { INTERPOLATION_METHODS, clampScale, scaleImageData } from './utils/interpolation.js';
import {
  EDGE_HANDLING,
  KERNEL_PRESETS,
  getPresetKernel,
  normalizeKernelValues,
} from './utils/kernels.js';
import gradientHalfMaskUrl from '../gradient-half-mask.gb7?url';
import kapibaraMaskUrl from '../kapibara-mask.gb7?url';
import verticalKapibaraUrl from '../vertical-kapibara.gb7?url';

const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gb7'];
const SAMPLE_IMAGES = [
  {
    title: 'Градиент с маской',
    fileName: 'gradient-half-mask.gb7',
    path: gradientHalfMaskUrl,
    type: 'application/octet-stream',
  },
  {
    title: 'Капибара с маской',
    fileName: 'kapibara-mask.gb7',
    path: kapibaraMaskUrl,
    type: 'application/octet-stream',
  },
  {
    title: 'Вертикальная капибара',
    fileName: 'vertical-kapibara.gb7',
    path: verticalKapibaraUrl,
    type: 'application/octet-stream',
  },
];
const DEFAULT_LEVELS = {
  black: 0,
  white: 255,
  gamma: 1,
};
const FILTER_MODES = {
  kernel: 'kernel',
  median: 'median',
};
const FILTER_PRESET_OPTIONS = [
  ...Object.values(KERNEL_PRESETS).map((preset) => ({
    key: preset.key,
    label: preset.label,
  })),
  {
    key: FILTER_MODES.median,
    label: 'Медианный 3x3',
  },
  {
    key: 'custom',
    label: 'Пользовательское ядро',
  },
];
const PREVIEW_MAX_SIZE = 320;

function getExtension(fileName) {
  return fileName.split('.').pop()?.toLowerCase() ?? '';
}

function replaceExtension(fileName, extension) {
  const cleanName = fileName.replace(/\.[^/.]+$/, '');
  return `${cleanName || 'image'}.${extension}`;
}

function formatBytes(bytes) {
  if (bytes < 1024) {
    return `${bytes} Б`;
  }

  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} КБ`;
  }

  return `${(bytes / 1024 / 1024).toFixed(2)} МБ`;
}

function downloadBlob(blob, fileName) {
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.href = url;
  link.download = fileName;
  link.click();

  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
          return;
        }

        reject(new Error('Не удалось подготовить файл для скачивания.'));
      },
      type,
      quality,
    );
  });
}

function createWhiteBackgroundCanvas(sourceCanvas) {
  const preparedCanvas = document.createElement('canvas');
  const context = preparedCanvas.getContext('2d');

  preparedCanvas.width = sourceCanvas.width;
  preparedCanvas.height = sourceCanvas.height;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, preparedCanvas.width, preparedCanvas.height);
  context.drawImage(sourceCanvas, 0, 0);

  return preparedCanvas;
}

function imageDataToCanvas(imageData) {
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');

  canvas.width = imageData.width;
  canvas.height = imageData.height;
  context.putImageData(imageData, 0, 0);

  return canvas;
}

function isGrayscaleImage(imageData) {
  const { data } = imageData;

  for (let i = 0; i < data.length; i += 4) {
    if (data[i] !== data[i + 1] || data[i] !== data[i + 2]) {
      return false;
    }
  }

  return true;
}

function getImageMode(imageData) {
  const isGray = isGrayscaleImage(imageData);
  const hasAlpha = imageHasTransparency(imageData);

  if (isGray) {
    return hasAlpha ? 'grayscale-alpha' : 'grayscale';
  }

  return hasAlpha ? 'rgb-alpha' : 'rgb';
}

function getChannelList(mode) {
  if (mode === 'grayscale') {
    return [{ key: 'gray', label: 'Gray', fullName: 'Яркость', type: 'gray' }];
  }

  if (mode === 'grayscale-alpha') {
    return [
      { key: 'gray', label: 'Gray', fullName: 'Яркость', type: 'gray' },
      { key: 'alpha', label: 'Alpha', fullName: 'Маска', type: 'alpha' },
    ];
  }

  const rgbChannels = [
    { key: 'red', label: 'Red', fullName: 'Красный', type: 'red' },
    { key: 'green', label: 'Green', fullName: 'Зеленый', type: 'green' },
    { key: 'blue', label: 'Blue', fullName: 'Синий', type: 'blue' },
  ];

  if (mode === 'rgb-alpha') {
    return [...rgbChannels, { key: 'alpha', label: 'Alpha', fullName: 'Альфа', type: 'alpha' }];
  }

  return rgbChannels;
}

function getModeLabel(mode) {
  const labels = {
    grayscale: '1 канал: grayscale',
    'grayscale-alpha': '2 канала: grayscale + alpha',
    rgb: '3 канала: RGB',
    'rgb-alpha': '4 канала: RGB + alpha',
  };

  return labels[mode] ?? '-';
}

function createEmptyImageData(width, height) {
  return new ImageData(width, height);
}

function cloneImageData(imageData) {
  return new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
}

function createPreviewImageData(imageData, maxSize = PREVIEW_MAX_SIZE) {
  const maxSide = Math.max(imageData.width, imageData.height);

  if (maxSide <= maxSize) {
    return cloneImageData(imageData);
  }

  const scale = maxSize / maxSide;

  return scaleImageData(
    imageData,
    Math.max(1, Math.round(imageData.width * scale)),
    Math.max(1, Math.round(imageData.height * scale)),
    INTERPOLATION_METHODS.bilinear.key,
  );
}

function isOnlyAlphaVisible(activeChannels) {
  const alphaEnabled = Boolean(activeChannels.alpha);
  const colorKeys = ['gray', 'red', 'green', 'blue'];

  return alphaEnabled && colorKeys.every((key) => !activeChannels[key]);
}

function applyChannelsToImage(imageData, activeChannels, mode) {
  const result = createEmptyImageData(imageData.width, imageData.height);
  const source = imageData.data;
  const target = result.data;
  const alphaMaskOnly = isOnlyAlphaVisible(activeChannels);

  for (let i = 0; i < source.length; i += 4) {
    const red = source[i];
    const green = source[i + 1];
    const blue = source[i + 2];
    const alpha = source[i + 3];

    if (alphaMaskOnly) {
      target[i] = alpha;
      target[i + 1] = alpha;
      target[i + 2] = alpha;
      target[i + 3] = 255;
      continue;
    }

    if (mode.startsWith('grayscale')) {
      const gray = activeChannels.gray ? red : 0;

      target[i] = gray;
      target[i + 1] = gray;
      target[i + 2] = gray;
      target[i + 3] = activeChannels.alpha ? alpha : 255;
      continue;
    }

    target[i] = activeChannels.red ? red : 0;
    target[i + 1] = activeChannels.green ? green : 0;
    target[i + 2] = activeChannels.blue ? blue : 0;
    target[i + 3] = activeChannels.alpha ? alpha : 255;
  }

  return result;
}

function getLevelsChannels(mode) {
  const options = [{ key: 'master', label: 'Master' }];

  if (mode?.startsWith('grayscale')) {
    options.push({ key: 'gray', label: 'Gray' });
  } else {
    options.push(
      { key: 'red', label: 'Red' },
      { key: 'green', label: 'Green' },
      { key: 'blue', label: 'Blue' },
    );
  }

  if (mode?.includes('alpha')) {
    options.push({ key: 'alpha', label: 'Alpha' });
  }

  return options;
}

function createDefaultLevelsSettings(mode) {
  return Object.fromEntries(getLevelsChannels(mode).map((channel) => [channel.key, { ...DEFAULT_LEVELS }]));
}

function normalizeLevels(levels) {
  const black = Math.min(Math.max(Number(levels.black), 0), 254);
  const white = Math.max(Math.min(Number(levels.white), 255), black + 1);
  const rawGamma = Number.isFinite(Number(levels.gamma)) ? Number(levels.gamma) : DEFAULT_LEVELS.gamma;
  const gamma = Math.round(Math.min(Math.max(rawGamma, 0.1), 9.9) * 100) / 100;

  return { black, white, gamma };
}

function makeLevelsLut(levels) {
  const { black, white, gamma } = normalizeLevels(levels);
  const lut = new Uint8ClampedArray(256);

  for (let value = 0; value < 256; value += 1) {
    const normalized = Math.min(Math.max((value - black) / (white - black), 0), 1);

    lut[value] = Math.round((normalized ** gamma) * 255);
  }

  return lut;
}

function applyLevelsToImage(imageData, settings) {
  const result = cloneImageData(imageData);
  const data = result.data;
  const master = makeLevelsLut(settings.master ?? DEFAULT_LEVELS);
  const red = makeLevelsLut(settings.red ?? settings.gray ?? DEFAULT_LEVELS);
  const green = makeLevelsLut(settings.green ?? settings.gray ?? DEFAULT_LEVELS);
  const blue = makeLevelsLut(settings.blue ?? settings.gray ?? DEFAULT_LEVELS);
  const gray = makeLevelsLut(settings.gray ?? DEFAULT_LEVELS);
  const alpha = makeLevelsLut(settings.alpha ?? DEFAULT_LEVELS);

  for (let i = 0; i < data.length; i += 4) {
    data[i] = settings.gray ? gray[master[data[i]]] : red[master[data[i]]];
    data[i + 1] = settings.gray ? gray[master[data[i + 1]]] : green[master[data[i + 1]]];
    data[i + 2] = settings.gray ? gray[master[data[i + 2]]] : blue[master[data[i + 2]]];

    if (settings.alpha) {
      data[i + 3] = alpha[data[i + 3]];
    }
  }

  return result;
}

function calculateHistogram(imageData, channelKey) {
  const histogram = new Array(256).fill(0);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    let value = 0;

    if (channelKey === 'red') {
      value = data[i];
    } else if (channelKey === 'green') {
      value = data[i + 1];
    } else if (channelKey === 'blue') {
      value = data[i + 2];
    } else if (channelKey === 'alpha') {
      value = data[i + 3];
    } else if (channelKey === 'gray') {
      value = data[i];
    } else {
      value = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
    }

    histogram[value] += 1;
  }

  return histogram;
}

function drawHistogram(canvas, histogram, isLogarithmic) {
  const context = canvas.getContext('2d');
  const width = canvas.width;
  const height = canvas.height;
  const values = histogram.map((value) => (isLogarithmic ? Math.log1p(value) : value));
  const max = Math.max(...values, 1);

  context.clearRect(0, 0, width, height);
  context.fillStyle = '#11151b';
  context.fillRect(0, 0, width, height);
  context.strokeStyle = '#2d333c';

  for (let i = 0; i <= 4; i += 1) {
    const y = Math.round((height / 4) * i);

    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
  }

  context.fillStyle = '#35c2b4';

  values.forEach((value, index) => {
    const barHeight = Math.max(1, Math.round((value / max) * (height - 8)));
    const x = Math.floor((index / 256) * width);
    const barWidth = Math.ceil(width / 256);

    context.fillRect(x, height - barHeight, barWidth, barHeight);
  });
}

function createChannelPreview(imageData, channel) {
  const result = createEmptyImageData(imageData.width, imageData.height);
  const source = imageData.data;
  const target = result.data;

  for (let i = 0; i < source.length; i += 4) {
    const red = source[i];
    const green = source[i + 1];
    const blue = source[i + 2];
    const alpha = source[i + 3];

    if (channel.type === 'gray') {
      target[i] = red;
      target[i + 1] = red;
      target[i + 2] = red;
    }

    if (channel.type === 'red') {
      target[i] = red;
      target[i + 1] = 0;
      target[i + 2] = 0;
    }

    if (channel.type === 'green') {
      target[i] = 0;
      target[i + 1] = green;
      target[i + 2] = 0;
    }

    if (channel.type === 'blue') {
      target[i] = 0;
      target[i + 1] = 0;
      target[i + 2] = blue;
    }

    if (channel.type === 'alpha') {
      target[i] = alpha;
      target[i + 1] = alpha;
      target[i + 2] = alpha;
    }

    target[i + 3] = 255;
  }

  return result;
}

function srgbToLinear(value) {
  const normalized = value / 255;

  if (normalized <= 0.04045) {
    return normalized / 12.92;
  }

  return ((normalized + 0.055) / 1.055) ** 2.4;
}

function pivotXyz(value) {
  if (value > 0.008856) {
    return value ** (1 / 3);
  }

  return 7.787 * value + 16 / 116;
}

function rgbToLab(red, green, blue) {
  const r = srgbToLinear(red);
  const g = srgbToLinear(green);
  const b = srgbToLinear(blue);

  const x = (r * 0.4124 + g * 0.3576 + b * 0.1805) / 0.95047;
  const y = (r * 0.2126 + g * 0.7152 + b * 0.0722) / 1.0;
  const z = (r * 0.0193 + g * 0.1192 + b * 0.9505) / 1.08883;
  const fx = pivotXyz(x);
  const fy = pivotXyz(y);
  const fz = pivotXyz(z);

  return {
    l: 116 * fy - 16,
    a: 500 * (fx - fy),
    b: 200 * (fy - fz),
  };
}

function formatLab(value) {
  return Number.isFinite(value) ? value.toFixed(2) : '-';
}

function formatMegapixels(width, height) {
  return `${((width * height) / 1_000_000).toFixed(3)} Мп`;
}

function formatKernelValue(value) {
  return Number.isInteger(value) ? String(value) : Number(value.toFixed(4)).toString();
}

function ChannelPreview({ channel, imageData, isActive, onToggle }) {
  const previewRef = useRef(null);

  useEffect(() => {
    if (!imageData || !previewRef.current) {
      return;
    }

    const preview = previewRef.current;
    const context = preview.getContext('2d');
    const previewData = createChannelPreview(imageData, channel);

    preview.width = imageData.width;
    preview.height = imageData.height;
    context.putImageData(previewData, 0, 0);
  }, [channel, imageData]);

  return (
    <button className={`channel-card${isActive ? ' is-active' : ''}`} type="button" onClick={onToggle}>
      <canvas ref={previewRef} className="channel-preview" />
      <span className="channel-text">
        <strong>{channel.fullName}</strong>
        <span>{channel.label}</span>
      </span>
      <span className="channel-state">{isActive ? <Eye size={16} /> : <EyeOff size={16} />}</span>
    </button>
  );
}

function ImageDataPreview({ imageData, title, status }) {
  const previewRef = useRef(null);

  useEffect(() => {
    if (!imageData || !previewRef.current) {
      return;
    }

    const preview = previewRef.current;
    const context = preview.getContext('2d');

    preview.width = imageData.width;
    preview.height = imageData.height;
    context.putImageData(imageData, 0, 0);
  }, [imageData]);

  return (
    <section className="dialog-preview">
      <div className="dialog-preview-header">
        <strong>{title}</strong>
        <span>{imageData ? `${imageData.width} x ${imageData.height}` : '-'}</span>
      </div>
      <div className="dialog-preview-frame">
        {imageData ? <canvas ref={previewRef} /> : <p>{status || 'Нет данных для предпросмотра.'}</p>}
      </div>
      {status && imageData && <p className="dialog-preview-status">{status}</p>}
    </section>
  );
}

function AppDialog({ open, className, onClose, children }) {
  const dialogRef = useRef(null);
  const dragRef = useRef(null);
  const [dialogOffset, setDialogOffset] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog) {
      return;
    }

    if (open && !dialog.open) {
      setDialogOffset({ x: 0, y: 0 });
      dialog.showModal();
    }

    if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    function handlePointerMove(event) {
      if (!dragRef.current) {
        return;
      }

      let nextX = dragRef.current.startX + event.clientX - dragRef.current.pointerX;
      let nextY = dragRef.current.startY + event.clientY - dragRef.current.pointerY;
      const margin = 14;
      const deltaX = nextX - dragRef.current.startX;
      const deltaY = nextY - dragRef.current.startY;
      const left = dragRef.current.rect.left + deltaX;
      const right = dragRef.current.rect.right + deltaX;
      const top = dragRef.current.rect.top + deltaY;
      const bottom = dragRef.current.rect.bottom + deltaY;

      if (left < margin) {
        nextX += margin - left;
      }

      if (right > window.innerWidth - margin) {
        nextX -= right - (window.innerWidth - margin);
      }

      if (top < margin) {
        nextY += margin - top;
      }

      if (bottom > window.innerHeight - margin) {
        nextY -= bottom - (window.innerHeight - margin);
      }

      setDialogOffset({ x: nextX, y: nextY });
    }

    function handlePointerUp() {
      dragRef.current = null;
    }

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, [open]);

  function startDialogDrag(event) {
    if (
      event.button !== 0 ||
      !event.target.closest('[data-dialog-drag-handle]') ||
      event.target.closest('button, input, select, textarea, label, a')
    ) {
      return;
    }

    dragRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      startX: dialogOffset.x,
      startY: dialogOffset.y,
      rect: dialogRef.current.getBoundingClientRect(),
    };
  }

  return (
    <dialog
      ref={dialogRef}
      className={className}
      style={{ transform: `translate(${dialogOffset.x}px, ${dialogOffset.y}px)` }}
      onPointerDown={startDialogDrag}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {children}
    </dialog>
  );
}

export default function App() {
  const canvasRef = useRef(null);
  const canvasAreaRef = useRef(null);
  const histogramRef = useRef(null);
  const fileInputRef = useRef(null);
  const filterWorkerRef = useRef(null);
  const filterWorkerCallbacksRef = useRef(new Map());
  const filterWorkerRequestIdRef = useRef(0);
  const filterPreviewJobRef = useRef(0);
  const [originalImageData, setOriginalImageData] = useState(null);
  const [previewImageData, setPreviewImageData] = useState(null);
  const [levelsBaseImageData, setLevelsBaseImageData] = useState(null);
  const [levelsPreviewBaseImageData, setLevelsPreviewBaseImageData] = useState(null);
  const [levelsDialogPreviewImageData, setLevelsDialogPreviewImageData] = useState(null);
  const [filterBaseImageData, setFilterBaseImageData] = useState(null);
  const [filterPreviewBaseImageData, setFilterPreviewBaseImageData] = useState(null);
  const [filterDialogPreviewImageData, setFilterDialogPreviewImageData] = useState(null);
  const [filterPreviewStatus, setFilterPreviewStatus] = useState('');
  const [imageInfo, setImageInfo] = useState(null);
  const [channelMode, setChannelMode] = useState(null);
  const [activeChannels, setActiveChannels] = useState({});
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [levelsPreview, setLevelsPreview] = useState(true);
  const [levelsChannel, setLevelsChannel] = useState('master');
  const [levelsSettings, setLevelsSettings] = useState({});
  const [histogramMode, setHistogramMode] = useState('linear');
  const [displayScale, setDisplayScale] = useState(100);
  const [displayInterpolation, setDisplayInterpolation] = useState(INTERPOLATION_METHODS.bilinear.key);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [resizeUnit, setResizeUnit] = useState('percent');
  const [resizeWidth, setResizeWidth] = useState(100);
  const [resizeHeight, setResizeHeight] = useState(100);
  const [resizeLinked, setResizeLinked] = useState(true);
  const [resizeMethod, setResizeMethod] = useState(INTERPOLATION_METHODS.bilinear.key);
  const [filterOpen, setFilterOpen] = useState(false);
  const [filterPreview, setFilterPreview] = useState(true);
  const [filterPreset, setFilterPreset] = useState(KERNEL_PRESETS.identity.key);
  const [kernelValues, setKernelValues] = useState(getPresetKernel(KERNEL_PRESETS.identity.key).map(formatKernelValue));
  const [filterChannels, setFilterChannels] = useState({
    red: true,
    green: true,
    blue: true,
    alpha: false,
  });
  const [filterEdgeHandling, setFilterEdgeHandling] = useState(EDGE_HANDLING.copy.key);
  const [isFiltering, setIsFiltering] = useState(false);
  const [pickedColor, setPickedColor] = useState(null);
  const [activeTool, setActiveTool] = useState('view');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isDragging, setIsDragging] = useState(false);

  const currentImageData = previewImageData ?? originalImageData;
  const channels = useMemo(() => (channelMode ? getChannelList(channelMode) : []), [channelMode]);
  const levelsChannels = useMemo(() => getLevelsChannels(channelMode), [channelMode]);
  const currentLevels = normalizeLevels(levelsSettings[levelsChannel] ?? DEFAULT_LEVELS);
  const resizeTarget = getResizeTarget();
  const resizeError = validateResizeTarget(resizeTarget);
  const filterChannelOptions = getFilterChannelOptions(channelMode);
  const filterError = validateFilterSettings();

  useEffect(() => {
    return () => {
      filterWorkerRef.current?.terminate();
      filterWorkerCallbacksRef.current.clear();
    };
  }, []);

  function getFilterWorker() {
    if (filterWorkerRef.current) {
      return filterWorkerRef.current;
    }

    const worker = new Worker(new URL('./workers/filterWorker.js', import.meta.url), { type: 'module' });

    worker.onmessage = (event) => {
      const { id, error: workerError, width, height, buffer } = event.data;
      const callback = filterWorkerCallbacksRef.current.get(id);

      if (!callback) {
        return;
      }

      filterWorkerCallbacksRef.current.delete(id);

      if (workerError) {
        callback.reject(new Error(workerError));
        return;
      }

      callback.resolve(new ImageData(new Uint8ClampedArray(buffer), width, height));
    };

    worker.onerror = (event) => {
      filterWorkerCallbacksRef.current.forEach((callback) => {
        callback.reject(new Error(event.message || 'Worker фильтра завершился с ошибкой.'));
      });
      filterWorkerCallbacksRef.current.clear();
    };

    filterWorkerRef.current = worker;

    return worker;
  }

  function runFilterInWorker(imageData, options) {
    const worker = getFilterWorker();
    const id = filterWorkerRequestIdRef.current + 1;
    const sourceData = new Uint8ClampedArray(imageData.data);

    filterWorkerRequestIdRef.current = id;

    return new Promise((resolve, reject) => {
      filterWorkerCallbacksRef.current.set(id, { resolve, reject });
      worker.postMessage(
        {
          id,
          width: imageData.width,
          height: imageData.height,
          buffer: sourceData.buffer,
          ...options,
        },
        [sourceData.buffer],
      );
    });
  }

  function getCurrentFilterMode() {
    return filterPreset === FILTER_MODES.median ? FILTER_MODES.median : FILTER_MODES.kernel;
  }

  function getCurrentFilterOptions() {
    return {
      mode: getCurrentFilterMode(),
      channels: getSelectedFilterChannels(),
      edgeHandling: filterEdgeHandling,
      kernel: normalizeKernelValues(kernelValues),
    };
  }

  function drawImageData(imageData, scale = displayScale, method = displayInterpolation) {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    const scaledWidth = Math.max(1, Math.round((imageData.width * scale) / 100));
    const scaledHeight = Math.max(1, Math.round((imageData.height * scale) / 100));
    const scaledImageData = scaleImageData(imageData, scaledWidth, scaledHeight, method);

    canvas.width = scaledImageData.width;
    canvas.height = scaledImageData.height;
    context.putImageData(scaledImageData, 0, 0);
  }

  function calculateInitialScale(imageData) {
    const area = canvasAreaRef.current;

    if (!area) {
      return 100;
    }

    const availableWidth = Math.max(1, area.clientWidth - 100);
    const availableHeight = Math.max(1, area.clientHeight - 100);
    const scale = Math.min(availableWidth / imageData.width, availableHeight / imageData.height) * 100;

    return clampScale(scale);
  }

  function prepareLoadedImage(imageData, info, warnings = '') {
    const mode = getImageMode(imageData);
    const nextChannels = Object.fromEntries(getChannelList(mode).map((channel) => [channel.key, true]));

    setOriginalImageData(imageData);
    setPreviewImageData(null);
    setLevelsBaseImageData(null);
    setLevelsPreviewBaseImageData(null);
    setLevelsDialogPreviewImageData(null);
    setFilterBaseImageData(null);
    setFilterPreviewBaseImageData(null);
    setFilterDialogPreviewImageData(null);
    setFilterPreviewStatus('');
    setImageInfo({
      ...info,
      channelMode: getModeLabel(mode),
    });
    setChannelMode(mode);
    setActiveChannels(nextChannels);
    setPickedColor(null);
    setNotice(warnings);
    setDisplayScale(calculateInitialScale(imageData));
  }

  useEffect(() => {
    if (!currentImageData || !channelMode) {
      return;
    }

    drawImageData(applyChannelsToImage(currentImageData, activeChannels, channelMode));
  }, [currentImageData, activeChannels, channelMode, displayScale, displayInterpolation]);

  useEffect(() => {
    if (!levelsOpen || !levelsPreview || !levelsBaseImageData) {
      if (!filterOpen) {
        setPreviewImageData(null);
      }
      return;
    }

    const frame = requestAnimationFrame(() => {
      setPreviewImageData(applyLevelsToImage(levelsBaseImageData, levelsSettings));
    });

    return () => cancelAnimationFrame(frame);
  }, [levelsOpen, levelsPreview, levelsBaseImageData, levelsSettings]);

  useEffect(() => {
    if (!levelsOpen || !levelsPreviewBaseImageData) {
      setLevelsDialogPreviewImageData(null);
      return;
    }

    const frame = requestAnimationFrame(() => {
      setLevelsDialogPreviewImageData(
        levelsPreview ? applyLevelsToImage(levelsPreviewBaseImageData, levelsSettings) : levelsPreviewBaseImageData,
      );
    });

    return () => cancelAnimationFrame(frame);
  }, [levelsOpen, levelsPreview, levelsPreviewBaseImageData, levelsSettings]);

  useEffect(() => {
    if (!filterOpen || !filterPreviewBaseImageData) {
      filterPreviewJobRef.current += 1;
      setFilterDialogPreviewImageData(null);
      setFilterPreviewStatus('');
      setPreviewImageData(null);
      return;
    }

    if (!filterPreview || filterError) {
      filterPreviewJobRef.current += 1;
      setFilterDialogPreviewImageData(filterPreviewBaseImageData);
      setFilterPreviewStatus(filterPreview ? filterError : 'Предпросмотр выключен.');
      setPreviewImageData(null);
      return;
    }

    const jobId = filterPreviewJobRef.current + 1;
    filterPreviewJobRef.current = jobId;
    setFilterPreviewStatus('Предпросмотр считается...');

    const frame = requestAnimationFrame(async () => {
      try {
        const filteredImageData = await runFilterInWorker(filterPreviewBaseImageData, getCurrentFilterOptions());

        if (filterPreviewJobRef.current === jobId) {
          setFilterDialogPreviewImageData(filteredImageData);
          setFilterPreviewStatus('');
        }
      } catch (currentError) {
        if (filterPreviewJobRef.current === jobId) {
          setFilterDialogPreviewImageData(filterPreviewBaseImageData);
          setFilterPreviewStatus(currentError.message);
        }
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [filterOpen, filterPreset, filterPreview, filterPreviewBaseImageData, kernelValues, filterChannels, filterEdgeHandling, filterError]);

  useEffect(() => {
    if (!levelsBaseImageData || !histogramRef.current) {
      return;
    }

    const histogram = calculateHistogram(levelsBaseImageData, levelsChannel);

    drawHistogram(histogramRef.current, histogram, histogramMode === 'log');
  }, [levelsBaseImageData, levelsChannel, histogramMode]);

  async function loadBrowserImage(file) {
    const url = URL.createObjectURL(file);

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Браузер не смог открыть изображение.'));
        img.src = url;
      });

      const workCanvas = document.createElement('canvas');
      const context = workCanvas.getContext('2d', { willReadFrequently: true });

      workCanvas.width = image.naturalWidth;
      workCanvas.height = image.naturalHeight;
      context.drawImage(image, 0, 0);

      const imageData = context.getImageData(0, 0, workCanvas.width, workCanvas.height);
      const hasAlpha = imageHasTransparency(imageData);
      const isJpeg = file.type === 'image/jpeg' || ['jpg', 'jpeg'].includes(getExtension(file.name));

      prepareLoadedImage(imageData, {
        name: file.name,
        format: isJpeg ? 'JPG' : 'PNG',
        width: workCanvas.width,
        height: workCanvas.height,
        colorDepth: isJpeg || !hasAlpha ? 24 : 32,
        fileSize: formatBytes(file.size),
        mask: hasAlpha ? 'альфа-канал' : 'нет',
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadGb7(file) {
    const result = decodeGb7(await file.arrayBuffer());

    prepareLoadedImage(
      result.imageData,
      {
        name: file.name,
        format: 'GB7',
        width: result.width,
        height: result.height,
        colorDepth: result.colorDepth,
        fileSize: formatBytes(file.size),
        mask: result.hasMask ? 'есть' : 'нет',
      },
      result.warnings.join(' '),
    );
  }

  async function openFile(file) {
    if (!file) {
      return;
    }

    const extension = getExtension(file.name);

    setError('');
    setNotice('');

    if (!SUPPORTED_EXTENSIONS.includes(extension)) {
      setError('Поддерживаются только PNG, JPG и GB7.');
      return;
    }

    try {
      if (extension === 'gb7') {
        await loadGb7(file);
      } else {
        await loadBrowserImage(file);
      }
    } catch (currentError) {
      setOriginalImageData(null);
      setPreviewImageData(null);
      setLevelsBaseImageData(null);
      setFilterBaseImageData(null);
      setImageInfo(null);
      setChannelMode(null);
      setPickedColor(null);
      setError(currentError.message);
    }
  }

  async function openSample(sample) {
    try {
      setError('');
      setNotice('');

      const response = await fetch(sample.path);

      if (!response.ok) {
        throw new Error('Не удалось открыть тестовый файл.');
      }

      const blob = await response.blob();
      const file = new File([blob], sample.fileName, { type: sample.type });

      await openFile(file);
    } catch (currentError) {
      setError(currentError.message);
    }
  }

  function handleInputChange(event) {
    openFile(event.target.files?.[0]);
    event.target.value = '';
  }

  function handleDrop(event) {
    event.preventDefault();
    setIsDragging(false);
    openFile(event.dataTransfer.files?.[0]);
  }

  function toggleChannel(channelKey) {
    if (!imageInfo) {
      return;
    }

    setActiveChannels((current) => ({
      ...current,
      [channelKey]: !current[channelKey],
    }));
  }

  function openLevelsDialog() {
    if (!originalImageData || !channelMode) {
      return;
    }

    const baseImageData = cloneImageData(originalImageData);
    const previewBaseImageData = createPreviewImageData(baseImageData);

    setLevelsBaseImageData(baseImageData);
    setLevelsPreviewBaseImageData(previewBaseImageData);
    setLevelsDialogPreviewImageData(previewBaseImageData);
    setLevelsSettings(createDefaultLevelsSettings(channelMode));
    setLevelsChannel('master');
    setLevelsPreview(true);
    setHistogramMode('linear');
    setLevelsOpen(true);
  }

  function getFilterChannelOptions(mode) {
    if (!mode) {
      return [];
    }

    if (mode.startsWith('grayscale')) {
      const options = [{ key: 'gray', label: 'Gray' }];

      if (mode.includes('alpha')) {
        options.push({ key: 'alpha', label: 'Alpha' });
      }

      return options;
    }

    const options = [
      { key: 'red', label: 'Red' },
      { key: 'green', label: 'Green' },
      { key: 'blue', label: 'Blue' },
    ];

    if (mode.includes('alpha')) {
      options.push({ key: 'alpha', label: 'Alpha' });
    }

    return options;
  }

  function createDefaultFilterChannels(mode) {
    return Object.fromEntries(
      getFilterChannelOptions(mode).map((channel) => [channel.key, channel.key !== 'alpha']),
    );
  }

  function getSelectedFilterChannels() {
    return Object.entries(filterChannels)
      .filter(([, isSelected]) => isSelected)
      .map(([channel]) => channel);
  }

  function validateFilterSettings() {
    if (!filterBaseImageData) {
      return filterOpen ? 'Сначала откройте изображение.' : '';
    }

    if (getCurrentFilterMode() === FILTER_MODES.kernel && !normalizeKernelValues(kernelValues)) {
      return 'Все 9 значений ядра должны быть числами.';
    }

    if (getSelectedFilterChannels().length === 0) {
      return 'Выберите хотя бы один канал для фильтрации.';
    }

    return '';
  }

  function openFilterDialog() {
    if (!originalImageData || !channelMode) {
      return;
    }

    const previewBaseImageData = createPreviewImageData(originalImageData);

    setFilterBaseImageData(cloneImageData(originalImageData));
    setFilterPreviewBaseImageData(previewBaseImageData);
    setFilterDialogPreviewImageData(previewBaseImageData);
    setFilterPreviewStatus('');
    setFilterPreset(KERNEL_PRESETS.identity.key);
    setKernelValues(getPresetKernel(KERNEL_PRESETS.identity.key).map(formatKernelValue));
    setFilterChannels(createDefaultFilterChannels(channelMode));
    setFilterEdgeHandling(EDGE_HANDLING.copy.key);
    setFilterPreview(true);
    setFilterOpen(true);
  }

  function cancelFilter() {
    filterPreviewJobRef.current += 1;
    setPreviewImageData(null);
    setFilterBaseImageData(null);
    setFilterPreviewBaseImageData(null);
    setFilterDialogPreviewImageData(null);
    setFilterPreviewStatus('');
    setFilterOpen(false);
    setIsFiltering(false);
  }

  function resetFilter() {
    setFilterPreset(KERNEL_PRESETS.identity.key);
    setKernelValues(getPresetKernel(KERNEL_PRESETS.identity.key).map(formatKernelValue));
    setFilterChannels(createDefaultFilterChannels(channelMode));
    setFilterEdgeHandling(EDGE_HANDLING.copy.key);
    setFilterPreview(true);
  }

  function selectFilterPreset(presetKey) {
    setFilterPreset(presetKey);

    if (presetKey in KERNEL_PRESETS) {
      setKernelValues(getPresetKernel(presetKey).map(formatKernelValue));
    }
  }

  function updateKernelValue(index, value) {
    setFilterPreset('custom');
    setKernelValues((current) => current.map((item, itemIndex) => (itemIndex === index ? value : item)));
  }

  function toggleFilterChannel(channelKey) {
    setFilterChannels((current) => ({
      ...current,
      [channelKey]: !current[channelKey],
    }));
  }

  async function applyFilter() {
    if (!filterBaseImageData || filterError || isFiltering) {
      return;
    }

    try {
      setError('');
      setIsFiltering(true);

      const filterOptions = {
        channels: getSelectedFilterChannels(),
        edgeHandling: filterEdgeHandling,
        mode: getCurrentFilterMode(),
        kernel: normalizeKernelValues(kernelValues),
      };
      const filteredImageData = await runFilterInWorker(filterBaseImageData, filterOptions);
      const mode = getImageMode(filteredImageData);
      const nextChannels = Object.fromEntries(getChannelList(mode).map((channel) => [channel.key, true]));

      setOriginalImageData(filteredImageData);
      setPreviewImageData(null);
      setFilterBaseImageData(null);
      setFilterPreviewBaseImageData(null);
      setFilterDialogPreviewImageData(null);
      setFilterPreviewStatus('');
      setImageInfo((current) => ({
        ...current,
        channelMode: getModeLabel(mode),
        fileSize: 'изменено',
      }));
      setChannelMode(mode);
      setActiveChannels(nextChannels);
      setPickedColor(null);
      setFilterOpen(false);
    } catch (currentError) {
      setError(currentError.message);
    } finally {
      setIsFiltering(false);
    }
  }

  function updateCurrentLevels(patch) {
    setLevelsSettings((current) => {
      const nextLevels = normalizeLevels({
        ...(current[levelsChannel] ?? DEFAULT_LEVELS),
        ...patch,
      });

      if (nextLevels.black >= nextLevels.white) {
        nextLevels.black = Math.max(0, nextLevels.white - 1);
      }

      return {
        ...current,
        [levelsChannel]: nextLevels,
      };
    });
  }

  function resetLevels() {
    setLevelsSettings(createDefaultLevelsSettings(channelMode));
  }

  function cancelLevels() {
    setPreviewImageData(null);
    setLevelsBaseImageData(null);
    setLevelsPreviewBaseImageData(null);
    setLevelsDialogPreviewImageData(null);
    setLevelsOpen(false);
  }

  function applyLevels() {
    if (!levelsBaseImageData) {
      return;
    }

    const correctedImageData = applyLevelsToImage(levelsBaseImageData, levelsSettings);

    setOriginalImageData(correctedImageData);
    setPreviewImageData(null);
    setLevelsBaseImageData(null);
    setLevelsPreviewBaseImageData(null);
    setLevelsDialogPreviewImageData(null);
    setFilterBaseImageData(null);
    setPickedColor(null);
    setLevelsOpen(false);
  }

  function getResizeTarget() {
    if (!originalImageData) {
      return { width: 0, height: 0 };
    }

    if (resizeUnit === 'percent') {
      return {
        width: Math.max(1, Math.round((originalImageData.width * Number(resizeWidth)) / 100)),
        height: Math.max(1, Math.round((originalImageData.height * Number(resizeHeight)) / 100)),
      };
    }

    return {
      width: Math.max(1, Math.round(Number(resizeWidth))),
      height: Math.max(1, Math.round(Number(resizeHeight))),
    };
  }

  function validateResizeTarget(target) {
    if (!originalImageData) {
      return 'Сначала откройте изображение.';
    }

    const rawWidth = Number(resizeWidth);
    const rawHeight = Number(resizeHeight);

    if (
      String(resizeWidth).trim() === '' ||
      String(resizeHeight).trim() === '' ||
      !Number.isFinite(rawWidth) ||
      !Number.isFinite(rawHeight)
    ) {
      return 'Введите числовые значения ширины и высоты.';
    }

    if (rawWidth < 1 || rawHeight < 1 || target.width < 1 || target.height < 1) {
      return 'Ширина и высота должны быть больше нуля.';
    }

    if (target.width > 8000 || target.height > 8000) {
      return 'Максимальный размер по каждой стороне - 8000 пикселей.';
    }

    if (target.width * target.height > 64_000_000) {
      return 'Итоговое изображение не должно быть больше 64 мегапикселей.';
    }

    if (resizeUnit === 'percent' && (Number(resizeWidth) < 1 || Number(resizeHeight) < 1)) {
      return 'Проценты должны быть не меньше 1.';
    }

    if (resizeUnit === 'percent' && (Number(resizeWidth) > 1000 || Number(resizeHeight) > 1000)) {
      return 'Проценты должны быть не больше 1000.';
    }

    return '';
  }

  function openResizeDialog() {
    if (!originalImageData) {
      return;
    }

    setResizeUnit('percent');
    setResizeWidth(100);
    setResizeHeight(100);
    setResizeLinked(true);
    setResizeMethod(INTERPOLATION_METHODS.bilinear.key);
    setResizeOpen(true);
  }

  function changeResizeUnit(unit) {
    if (!originalImageData) {
      return;
    }

    setResizeUnit(unit);

    if (unit === 'percent') {
      setResizeWidth(100);
      setResizeHeight(100);
    } else {
      setResizeWidth(originalImageData.width);
      setResizeHeight(originalImageData.height);
    }
  }

  function updateResizeWidth(value) {
    const nextWidth = Number(value);

    setResizeWidth(value);

    if (!resizeLinked || !originalImageData || !Number.isFinite(nextWidth)) {
      return;
    }

    if (resizeUnit === 'percent') {
      setResizeHeight(value);
      return;
    }

    setResizeHeight(Math.max(1, Math.round((nextWidth * originalImageData.height) / originalImageData.width)));
  }

  function updateResizeHeight(value) {
    const nextHeight = Number(value);

    setResizeHeight(value);

    if (!resizeLinked || !originalImageData || !Number.isFinite(nextHeight)) {
      return;
    }

    if (resizeUnit === 'percent') {
      setResizeWidth(value);
      return;
    }

    setResizeWidth(Math.max(1, Math.round((nextHeight * originalImageData.width) / originalImageData.height)));
  }

  function cancelResize() {
    setResizeOpen(false);
  }

  function applyResize() {
    if (!originalImageData || resizeError) {
      return;
    }

    const resizedImageData = scaleImageData(originalImageData, resizeTarget.width, resizeTarget.height, resizeMethod);
    const mode = getImageMode(resizedImageData);
    const nextChannels = Object.fromEntries(getChannelList(mode).map((channel) => [channel.key, true]));

    setOriginalImageData(resizedImageData);
    setPreviewImageData(null);
    setFilterBaseImageData(null);
    setImageInfo((current) => ({
      ...current,
      width: resizedImageData.width,
      height: resizedImageData.height,
      channelMode: getModeLabel(mode),
      fileSize: 'изменено',
    }));
    setChannelMode(mode);
    setActiveChannels(nextChannels);
    setPickedColor(null);
    setResizeOpen(false);
  }

  function handleCanvasClick(event) {
    if (activeTool !== 'pipette' || !currentImageData) {
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const renderedX = ((event.clientX - rect.left) / rect.width) * canvas.width;
    const renderedY = ((event.clientY - rect.top) / rect.height) * canvas.height;
    const x = Math.floor((renderedX / canvas.width) * currentImageData.width);
    const y = Math.floor((renderedY / canvas.height) * currentImageData.height);

    if (x < 0 || y < 0 || x >= currentImageData.width || y >= currentImageData.height) {
      return;
    }

    const index = (y * currentImageData.width + x) * 4;
    const red = currentImageData.data[index];
    const green = currentImageData.data[index + 1];
    const blue = currentImageData.data[index + 2];
    const alpha = currentImageData.data[index + 3];
    const lab = rgbToLab(red, green, blue);

    setPickedColor({ x, y, red, green, blue, alpha, lab });
  }

  async function downloadCurrent(format) {
    if (!imageInfo) {
      return;
    }

    const visibleImageData = applyChannelsToImage(currentImageData, activeChannels, channelMode);
    const exportCanvas = imageDataToCanvas(visibleImageData);

    try {
      setError('');

      if (format === 'png') {
        const blob = await canvasToBlob(exportCanvas, 'image/png');
        downloadBlob(blob, replaceExtension(imageInfo.name, 'png'));
      }

      if (format === 'jpg') {
        const preparedCanvas = createWhiteBackgroundCanvas(exportCanvas);
        const blob = await canvasToBlob(preparedCanvas, 'image/jpeg', 0.92);
        downloadBlob(blob, replaceExtension(imageInfo.name, 'jpg'));
      }

      if (format === 'gb7') {
        const buffer = encodeGb7(visibleImageData, visibleImageData.width, visibleImageData.height);
        const blob = new Blob([buffer], { type: 'application/octet-stream' });

        downloadBlob(blob, replaceExtension(imageInfo.name, 'gb7'));
      }
    } catch (currentError) {
      setError(currentError.message);
    }
  }

  function resetImage() {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d');

    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
    setOriginalImageData(null);
    setPreviewImageData(null);
    setLevelsBaseImageData(null);
    setFilterBaseImageData(null);
    setImageInfo(null);
    setChannelMode(null);
    setActiveChannels({});
    setPickedColor(null);
    setActiveTool('view');
    setLevelsOpen(false);
    setFilterOpen(false);
    setDisplayScale(100);
    setDisplayInterpolation(INTERPOLATION_METHODS.bilinear.key);
    setError('');
    setNotice('');
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <FileImage size={21} strokeWidth={2.2} />
          </span>
          <div>
            <h1>Шатило Михаил 231-323</h1>
          </div>
        </div>

        <div className="top-actions">
          <button className="primary-button" type="button" onClick={() => fileInputRef.current.click()}>
            <FolderOpen size={18} />
            Открыть
          </button>
          <button
            className={activeTool === 'pipette' ? 'tool-button is-selected' : 'tool-button'}
            type="button"
            onClick={() => setActiveTool((current) => (current === 'pipette' ? 'view' : 'pipette'))}
            disabled={!imageInfo}
            title="Пипетка"
          >
            <Pipette size={18} />
            Пипетка
          </button>
          <button className="tool-button" type="button" onClick={openLevelsDialog} disabled={!imageInfo}>
            <SlidersHorizontal size={18} />
            Уровни
          </button>
          <button className="tool-button" type="button" onClick={openFilterDialog} disabled={!imageInfo}>
            <PanelTopOpen size={18} />
            Фильтр
          </button>
          <button className="tool-button" type="button" onClick={openResizeDialog} disabled={!imageInfo}>
            <Maximize2 size={18} />
            Размер
          </button>
          <button type="button" onClick={() => downloadCurrent('png')} disabled={!imageInfo}>
            <Download size={18} />
            PNG
          </button>
          <button type="button" onClick={() => downloadCurrent('jpg')} disabled={!imageInfo}>
            <Download size={18} />
            JPG
          </button>
          <button type="button" onClick={() => downloadCurrent('gb7')} disabled={!imageInfo}>
            <ImageDown size={18} />
            GB7
          </button>
          <button className="icon-button" type="button" onClick={resetImage} disabled={!imageInfo} title="Очистить">
            <RotateCcw size={18} />
          </button>
        </div>
      </header>

      <input
        ref={fileInputRef}
        className="hidden-input"
        type="file"
        accept=".png,.jpg,.jpeg,.gb7,image/png,image/jpeg"
        onChange={handleInputChange}
      />

      <main className="workspace">
        <aside className="sidebar">
          <button
            className={`drop-panel${isDragging ? ' is-dragging' : ''}`}
            type="button"
            onClick={() => fileInputRef.current.click()}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <Upload size={26} />
            <span>
              <strong>Зона загрузки</strong>
              <small>Нажмите или перетащите PNG, JPG, GB7</small>
            </span>
          </button>

          <section className="samples-panel">
            <div className="panel-heading">
              <FileImage size={18} />
              <h2>Тестовые файлы</h2>
            </div>

            <div className="sample-list">
              {SAMPLE_IMAGES.map((sample) => (
                <button className="sample-button" type="button" key={sample.fileName} onClick={() => openSample(sample)}>
                  {sample.title}
                </button>
              ))}
            </div>
          </section>

          <section className="info-panel">
            <div className="panel-heading">
              <Info size={18} />
              <h2>Свойства</h2>
            </div>

            <dl className="metadata">
              <div>
                <dt>Имя</dt>
                <dd>{imageInfo?.name ?? 'не выбрано'}</dd>
              </div>
              <div>
                <dt>Формат</dt>
                <dd>{imageInfo?.format ?? '-'}</dd>
              </div>
              <div>
                <dt>Размер</dt>
                <dd>{imageInfo ? `${imageInfo.width} x ${imageInfo.height}` : '-'}</dd>
              </div>
              <div>
                <dt>Глубина</dt>
                <dd>{imageInfo ? `${imageInfo.colorDepth} бит` : '-'}</dd>
              </div>
              <div>
                <dt>Каналы</dt>
                <dd>{imageInfo?.channelMode ?? '-'}</dd>
              </div>
              <div>
                <dt>Маска</dt>
                <dd>{imageInfo?.mask ?? '-'}</dd>
              </div>
              <div>
                <dt>Файл</dt>
                <dd>{imageInfo?.fileSize ?? '-'}</dd>
              </div>
            </dl>

            <div className="scale-control">
              <label>
                Масштаб: {displayScale}%
                <input
                  type="range"
                  min="12"
                  max="300"
                  value={displayScale}
                  onChange={(event) => setDisplayScale(clampScale(Number(event.target.value)))}
                  disabled={!imageInfo}
                />
              </label>
              <label>
                Интерполяция
                <select
                  value={displayInterpolation}
                  onChange={(event) => setDisplayInterpolation(event.target.value)}
                  disabled={!imageInfo}
                >
                  {Object.values(INTERPOLATION_METHODS).map((method) => (
                    <option key={method.key} value={method.key}>
                      {method.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </section>

          <section className="channels-panel">
            <div className="panel-heading">
              <Eye size={18} />
              <h2>Каналы</h2>
            </div>

            {imageInfo ? (
              <div className="channel-list">
                {channels.map((channel) => (
                  <ChannelPreview
                    key={channel.key}
                    channel={channel}
                    imageData={currentImageData}
                    isActive={Boolean(activeChannels[channel.key])}
                    onToggle={() => toggleChannel(channel.key)}
                  />
                ))}
              </div>
            ) : (
              <p className="panel-placeholder">Откройте изображение, чтобы увидеть каналы.</p>
            )}
          </section>
        </aside>

        <section className="editor">
          <div className="editor-toolbar">
            <div>
              <span className="toolbar-label">Холст</span>
              <strong>{imageInfo ? `${imageInfo.width} x ${imageInfo.height} / ${displayScale}%` : 'пусто'}</strong>
            </div>
          </div>

          <div ref={canvasAreaRef} className={`canvas-area${activeTool === 'pipette' ? ' is-pipette' : ''}`}>
            {!imageInfo && (
              <div className="empty-state">
                <FileImage size={42} />
                <h2>Откройте изображение</h2>
                <p>Файл появится на canvas.</p>
              </div>
            )}
            <canvas
              ref={canvasRef}
              className="image-canvas"
              onClick={handleCanvasClick}
            />
          </div>
        </section>

        <aside className="rightbar">
          <section className="pipette-panel">
            <div className="panel-heading">
              <Pipette size={18} />
              <h2>Пипетка</h2>
            </div>

            {pickedColor ? (
              <>
                <div
                  className="color-swatch"
                  style={{ backgroundColor: `rgb(${pickedColor.red}, ${pickedColor.green}, ${pickedColor.blue})` }}
                />
                <dl className="metadata compact-metadata">
                  <div>
                    <dt>X</dt>
                    <dd>{pickedColor.x}</dd>
                  </div>
                  <div>
                    <dt>Y</dt>
                    <dd>{pickedColor.y}</dd>
                  </div>
                  <div>
                    <dt>R</dt>
                    <dd>{pickedColor.red}</dd>
                  </div>
                  <div>
                    <dt>G</dt>
                    <dd>{pickedColor.green}</dd>
                  </div>
                  <div>
                    <dt>B</dt>
                    <dd>{pickedColor.blue}</dd>
                  </div>
                  <div>
                    <dt>A</dt>
                    <dd>{pickedColor.alpha}</dd>
                  </div>
                  <div>
                    <dt>L*</dt>
                    <dd>{formatLab(pickedColor.lab.l)}</dd>
                  </div>
                  <div>
                    <dt>a*</dt>
                    <dd>{formatLab(pickedColor.lab.a)}</dd>
                  </div>
                  <div>
                    <dt>b*</dt>
                    <dd>{formatLab(pickedColor.lab.b)}</dd>
                  </div>
                </dl>
              </>
            ) : (
              <p className="panel-placeholder">
                Включите пипетку и кликните по изображению, чтобы получить RGB и CIELAB.
              </p>
            )}
          </section>
        </aside>
      </main>

      {(error || notice) && (
        <div className={`message-bar${error ? ' is-error' : ''}`} role="status">
          {error || notice}
        </div>
      )}

      <AppDialog open={levelsOpen} className="levels-dialog" onClose={cancelLevels}>
        <form method="dialog" className="levels-content">
          <div className="levels-header">
            <div data-dialog-drag-handle>
              <h2>Уровни</h2>
              <p>Градационная коррекция изображения</p>
            </div>
            <button className="icon-button" type="button" onClick={cancelLevels} title="Закрыть">
              <X size={18} />
            </button>
          </div>

          <div className="levels-row">
            <label>
              Канал
              <select value={levelsChannel} onChange={(event) => setLevelsChannel(event.target.value)}>
                {levelsChannels.map((channel) => (
                  <option key={channel.key} value={channel.key}>
                    {channel.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Гистограмма
              <select value={histogramMode} onChange={(event) => setHistogramMode(event.target.value)}>
                <option value="linear">Линейная</option>
                <option value="log">Логарифмическая</option>
              </select>
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={levelsPreview}
                onChange={(event) => setLevelsPreview(event.target.checked)}
              />
              Предпросмотр
            </label>
          </div>

          <div className="histogram-box">
            <canvas ref={histogramRef} width="512" height="180" />
            <div className="histogram-scale">
              <span>0</span>
              <span>127</span>
              <span>255</span>
            </div>
          </div>

          <ImageDataPreview
            imageData={levelsDialogPreviewImageData}
            title="Предпросмотр уровней"
            status={levelsPreview ? '' : 'Предпросмотр выключен.'}
          />

          <div className="level-sliders">
            <label>
              <span>Черная точка: {currentLevels.black}</span>
              <input
                type="range"
                min="0"
                max="255"
                value={currentLevels.black}
                onChange={(event) => updateCurrentLevels({ black: Math.min(Number(event.target.value), currentLevels.white - 1) })}
              />
            </label>

            <label>
              <span>Полутона: γ {currentLevels.gamma.toFixed(2)}</span>
              <input
                type="range"
                min="0.1"
                max="9.9"
                step="0.01"
                value={currentLevels.gamma}
                onChange={(event) => updateCurrentLevels({ gamma: Number(event.target.value) })}
              />
            </label>

            <label>
              <span>Белая точка: {currentLevels.white}</span>
              <input
                type="range"
                min="0"
                max="255"
                value={currentLevels.white}
                onChange={(event) => updateCurrentLevels({ white: Math.max(Number(event.target.value), currentLevels.black + 1) })}
              />
            </label>
          </div>

          <div className="levels-values">
            <label>
              Black
              <input
                type="number"
                min="0"
                max={currentLevels.white - 1}
                value={currentLevels.black}
                onChange={(event) => updateCurrentLevels({ black: Number(event.target.value) })}
              />
            </label>
            <label>
              Gamma
              <input
                type="number"
                min="0.1"
                max="9.9"
                step="0.01"
                value={currentLevels.gamma}
                onChange={(event) => updateCurrentLevels({ gamma: Number(event.target.value) })}
              />
            </label>
            <label>
              White
              <input
                type="number"
                min={currentLevels.black + 1}
                max="255"
                value={currentLevels.white}
                onChange={(event) => updateCurrentLevels({ white: Number(event.target.value) })}
              />
            </label>
          </div>

          <div className="levels-actions">
            <button type="button" onClick={resetLevels}>
              Сброс
            </button>
            <button type="button" onClick={cancelLevels}>
              Отмена
            </button>
            <button className="primary-button" type="button" onClick={applyLevels}>
              Применить
            </button>
          </div>
        </form>
      </AppDialog>

      <AppDialog open={filterOpen} className="filter-dialog" onClose={cancelFilter}>
        <form method="dialog" className="filter-content">
          <div className="levels-header">
            <div data-dialog-drag-handle>
              <h2>Фильтр Custom</h2>
              <p>Свёртка изображения ядром 3x3</p>
            </div>
            <button className="icon-button" type="button" onClick={cancelFilter} title="Закрыть">
              <X size={18} />
            </button>
          </div>

          <div className="filter-grid">
            <label>
              Фильтр
              <select value={filterPreset} onChange={(event) => selectFilterPreset(event.target.value)}>
                {FILTER_PRESET_OPTIONS.map((preset) => (
                  <option key={preset.key} value={preset.key}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </label>

            <label>
              Заполнение края
              <select value={filterEdgeHandling} onChange={(event) => setFilterEdgeHandling(event.target.value)}>
                {Object.values(EDGE_HANDLING).map((edge) => (
                  <option key={edge.key} value={edge.key}>
                    {edge.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={filterPreview}
                onChange={(event) => setFilterPreview(event.target.checked)}
              />
              Предпросмотр
            </label>
          </div>

          <div className="kernel-editor" aria-label="Ядро 3 на 3">
            {kernelValues.map((value, index) => (
              <input
                key={index}
                type="number"
                step="0.0001"
                value={value}
                onChange={(event) => updateKernelValue(index, event.target.value)}
                disabled={getCurrentFilterMode() === FILTER_MODES.median}
                aria-label={`Значение ядра ${index + 1}`}
              />
            ))}
          </div>

          <ImageDataPreview
            imageData={filterDialogPreviewImageData}
            title="Предпросмотр фильтра"
            status={filterPreviewStatus}
          />

          <fieldset className="filter-channels">
            <legend>Каналы</legend>
            {filterChannelOptions.map((channel) => (
              <label className="checkbox-field" key={channel.key}>
                <input
                  type="checkbox"
                  checked={Boolean(filterChannels[channel.key])}
                  onChange={() => toggleFilterChannel(channel.key)}
                />
                {channel.label}
              </label>
            ))}
          </fieldset>

          <div className="resize-result">
            {isFiltering
              ? 'Фильтр применяется...'
              : getCurrentFilterMode() === FILTER_MODES.median
                ? 'Медианный фильтр заменяет значение выбранного канала медианой соседей 3x3.'
                : 'Размер изображения сохраняется после обработки краёв.'}
          </div>

          {filterError && <p className="validation-message">{filterError}</p>}

          <div className="levels-actions">
            <button type="button" onClick={resetFilter} disabled={isFiltering}>
              Сбросить
            </button>
            <button type="button" onClick={cancelFilter} disabled={isFiltering}>
              Закрыть
            </button>
            <button className="primary-button" type="button" onClick={applyFilter} disabled={Boolean(filterError) || isFiltering}>
              Применить
            </button>
          </div>
        </form>
      </AppDialog>

      <AppDialog open={resizeOpen} className="resize-dialog" onClose={cancelResize}>
        <form method="dialog" className="resize-content">
          <div className="levels-header">
            <div data-dialog-drag-handle>
              <h2>Размер изображения</h2>
              <p>Изменение реального количества пикселей</p>
            </div>
            <button className="icon-button" type="button" onClick={cancelResize} title="Закрыть">
              <X size={18} />
            </button>
          </div>

          <div className="pixel-summary">
            <div>
              <span>До</span>
              <strong>{originalImageData ? formatMegapixels(originalImageData.width, originalImageData.height) : '-'}</strong>
            </div>
            <div>
              <span>После</span>
              <strong>{formatMegapixels(resizeTarget.width, resizeTarget.height)}</strong>
            </div>
          </div>

          <div className="resize-grid">
            <label>
              Значения
              <select value={resizeUnit} onChange={(event) => changeResizeUnit(event.target.value)}>
                <option value="percent">Проценты</option>
                <option value="pixels">Пиксели</option>
              </select>
            </label>

            <label>
              Ширина
              <input
                type="number"
                min={resizeUnit === 'percent' ? 1 : 1}
                max={resizeUnit === 'percent' ? 1000 : 8000}
                value={resizeWidth}
                onChange={(event) => updateResizeWidth(event.target.value)}
              />
            </label>

            <label>
              Высота
              <input
                type="number"
                min={resizeUnit === 'percent' ? 1 : 1}
                max={resizeUnit === 'percent' ? 1000 : 8000}
                value={resizeHeight}
                onChange={(event) => updateResizeHeight(event.target.value)}
              />
            </label>
          </div>

          <label className="checkbox-field resize-checkbox">
            <input
              type="checkbox"
              checked={resizeLinked}
              onChange={(event) => setResizeLinked(event.target.checked)}
            />
            Сохранять пропорции
          </label>

          <label className="resize-method">
            Алгоритм интерполяции
            <select value={resizeMethod} onChange={(event) => setResizeMethod(event.target.value)}>
              {Object.values(INTERPOLATION_METHODS).map((method) => (
                <option key={method.key} value={method.key}>
                  {method.label}
                </option>
              ))}
            </select>
          </label>

          <p className="method-tooltip" role="tooltip">
            {INTERPOLATION_METHODS[resizeMethod].description}
          </p>

          <div className="resize-result">
            Итоговый размер: {resizeTarget.width} x {resizeTarget.height} px
          </div>

          {resizeError && <p className="validation-message">{resizeError}</p>}

          <div className="levels-actions">
            <button type="button" onClick={cancelResize}>
              Отмена
            </button>
            <button className="primary-button" type="button" onClick={applyResize} disabled={Boolean(resizeError)}>
              Применить
            </button>
          </div>
        </form>
      </AppDialog>

      <footer className="statusbar">
        {imageInfo
          ? `Ширина: ${imageInfo.width}px | Высота: ${imageInfo.height}px | Глубина цвета: ${imageInfo.colorDepth} бит`
          : 'Ширина: - | Высота: - | Глубина цвета: -'}
      </footer>
    </div>
  );
}
