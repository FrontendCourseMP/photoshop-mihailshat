import { useRef, useState } from 'react';
import {
  Download,
  FileImage,
  FolderOpen,
  ImageDown,
  Info,
  RotateCcw,
  Upload,
} from 'lucide-react';
import { decodeGb7, encodeGb7, imageHasTransparency } from './utils/gb7.js';

const SUPPORTED_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gb7'];
const ZOOM_OPTIONS = [
  { value: 'fit', label: 'По размеру окна' },
  { value: '0.5', label: '50%' },
  { value: '1', label: '100%' },
  { value: '2', label: '200%' },
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

export default function App() {
  const canvasRef = useRef(null);
  const fileInputRef = useRef(null);
  const [imageInfo, setImageInfo] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [isDragging, setIsDragging] = useState(false);
  const [zoom, setZoom] = useState('fit');

  function drawImageData(imageData) {
    const canvas = canvasRef.current;
    const context = canvas.getContext('2d', { willReadFrequently: true });

    canvas.width = imageData.width;
    canvas.height = imageData.height;
    context.putImageData(imageData, 0, 0);
  }

  async function loadBrowserImage(file) {
    const url = URL.createObjectURL(file);

    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Браузер не смог открыть изображение.'));
        img.src = url;
      });

      const canvas = canvasRef.current;
      const context = canvas.getContext('2d', { willReadFrequently: true });

      canvas.width = image.naturalWidth;
      canvas.height = image.naturalHeight;
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const hasAlpha = imageHasTransparency(imageData);
      const isJpeg = file.type === 'image/jpeg' || ['jpg', 'jpeg'].includes(getExtension(file.name));

      setImageInfo({
        name: file.name,
        format: isJpeg ? 'JPG' : 'PNG',
        width: canvas.width,
        height: canvas.height,
        colorDepth: isJpeg || !hasAlpha ? 24 : 32,
        fileSize: formatBytes(file.size),
        mask: hasAlpha ? 'альфа-канал' : 'нет',
      });
      setNotice('');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadGb7(file) {
    const result = decodeGb7(await file.arrayBuffer());

    drawImageData(result.imageData);
    setImageInfo({
      name: file.name,
      format: 'GB7',
      width: result.width,
      height: result.height,
      colorDepth: result.colorDepth,
      fileSize: formatBytes(file.size),
      mask: result.hasMask ? 'есть' : 'нет',
    });
    setNotice(result.warnings.join(' '));
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
      setImageInfo(null);
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
    setImageInfo(null);
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
            <p className="brand-label">Лабораторная работа 1</p>
            <h1>GrayBit Studio</h1>
          </div>
        </div>

        <div className="top-actions">
          <button className="primary-button" type="button" onClick={() => fileInputRef.current.click()}>
            <FolderOpen size={18} />
            Открыть
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
          <section
            className={`drop-panel${isDragging ? ' is-dragging' : ''}`}
            onDragOver={(event) => {
              event.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={handleDrop}
          >
            <Upload size={26} />
            <div>
              <h2>Файл изображения</h2>
              <p>PNG, JPG, GB7</p>
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
                <dt>Маска</dt>
                <dd>{imageInfo?.mask ?? '-'}</dd>
              </div>
              <div>
                <dt>Файл</dt>
                <dd>{imageInfo?.fileSize ?? '-'}</dd>
              </div>
            </dl>
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

          <div className="canvas-area">
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
            />
          </div>
        </section>
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

