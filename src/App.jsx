import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  FileImage,
  FolderOpen,
  ImageDown,
  Info,
  Pipette,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { decodeGb7, encodeGb7, imageHasTransparency } from './utils/gb7.js';
import gradientHalfMaskUrl from '../gradient-half-mask.gb7?url';
import kapibaraMaskUrl from '../kapibara-mask.gb7?url';
import verticalKapibaraUrl from '../vertical-kapibara.gb7?url';

const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gb7'];
const ZOOM_OPTIONS = [
  { value: 'fit', label: 'По размеру окна' },
  { value: '0.5', label: '50%' },
  { value: '1', label: '100%' },
  { value: '2', label: '200%' },
];
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

export default function App() {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [originalImageData, setOriginalImageData] = useState(null);
  const [imageInfo, setImageInfo] = useState(null);
  const [channelMode, setChannelMode] = useState(null);
  const [activeChannels, setActiveChannels] = useState({});
  const [pickedColor, setPickedColor] = useState(null);
  const [activeTool, setActiveTool] = useState('view');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState('fit');

  const channels = useMemo(() => (channelMode ? getChannelList(channelMode) : []), [channelMode]);

  function drawImageData(imageData) {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    canvas.width = imageData.width;
    canvas.height = imageData.height;
    context.putImageData(imageData, 0, 0);
  }

  function prepareLoadedImage(imageData, info, warnings = '') {
    const mode = getImageMode(imageData);
    const nextChannels = Object.fromEntries(getChannelList(mode).map((channel) => [channel.key, true]));

    setOriginalImageData(imageData);
    setImageInfo({
      ...info,
      channelMode: getModeLabel(mode),
    });
    setChannelMode(mode);
    setActiveChannels(nextChannels);
    setPickedColor(null);
    setNotice(warnings);
    drawImageData(imageData);
  }

  useEffect(() => {
    if (!originalImageData || !channelMode) {
      return;
    }

    drawImageData(applyChannelsToImage(originalImageData, activeChannels, channelMode));
  }, [originalImageData, activeChannels, channelMode]);

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

  function handleCanvasClick(event) {
    if (activeTool !== 'pipette' || !originalImageData) {
      return;
    }

    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const x = Math.floor(((event.clientX - rect.left) / rect.width) * canvas.width);
    const y = Math.floor(((event.clientY - rect.top) / rect.height) * canvas.height);

    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
      return;
    }

    const index = (y * originalImageData.width + x) * 4;
    const red = originalImageData.data[index];
    const green = originalImageData.data[index + 1];
    const blue = originalImageData.data[index + 2];
    const alpha = originalImageData.data[index + 3];
    const lab = rgbToLab(red, green, blue);

    setPickedColor({ x, y, red, green, blue, alpha, lab });
  }

  async function downloadCurrent(format) {
    if (!imageInfo) {
      return;
    }

    const canvas = canvasRef.current;

    try {
      setError('');

      if (format === 'png') {
        const blob = await canvasToBlob(canvas, 'image/png');
        downloadBlob(blob, replaceExtension(imageInfo.name, 'png'));
      }

      if (format === 'jpg') {
        const preparedCanvas = createWhiteBackgroundCanvas(canvas);
        const blob = await canvasToBlob(preparedCanvas, 'image/jpeg', 0.92);
        downloadBlob(blob, replaceExtension(imageInfo.name, 'jpg'));
      }

      if (format === 'gb7') {
        const context = canvas.getContext('2d', { willReadFrequently: true });
        const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
        const buffer = encodeGb7(imageData, canvas.width, canvas.height);
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
    setImageInfo(null);
    setChannelMode(null);
    setActiveChannels({});
    setPickedColor(null);
    setActiveTool('view');
    setError('');
    setNotice('');
  }

  const canvasStyle =
    imageInfo && zoom !== 'fit'
      ? {
          width: `${imageInfo.width * Number(zoom)}px`,
          height: `${imageInfo.height * Number(zoom)}px`,
        }
      : undefined;

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
                    imageData={originalImageData}
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
              <strong>{imageInfo ? `${imageInfo.width} x ${imageInfo.height}` : 'пусто'}</strong>
            </div>

            <label className="zoom-control">
              Масштаб
              <select value={zoom} onChange={(event) => setZoom(event.target.value)} disabled={!imageInfo}>
                {ZOOM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className={`canvas-area${activeTool === 'pipette' ? ' is-pipette' : ''}`}>
            {!imageInfo && (
              <div className="empty-state">
                <FileImage size={42} />
                <h2>Откройте изображение</h2>
                <p>Файл появится на canvas.</p>
              </div>
            )}
            <canvas
              ref={canvasRef}
              className={`image-canvas${imageInfo && zoom === 'fit' ? ' fit-canvas' : ''}`}
              style={canvasStyle}
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

      <footer className="statusbar">
        {imageInfo
          ? `Ширина: ${imageInfo.width}px | Высота: ${imageInfo.height}px | Глубина цвета: ${imageInfo.colorDepth} бит`
          : 'Ширина: - | Высота: - | Глубина цвета: -'}
      </footer>
    </div>
  );
}

