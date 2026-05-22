export const EDGE_HANDLING = {
  black: { key: 'black', label: 'Черный' },
  white: { key: 'white', label: 'Белый' },
  copy: { key: 'copy', label: 'Копирование' },
};

export const KERNEL_PRESETS = {
  identity: {
    key: 'identity',
    label: 'Тождественное отображение',
    values: [0, 0, 0, 0, 1, 0, 0, 0, 0],
  },
  sharpen: {
    key: 'sharpen',
    label: 'Повышение резкости',
    values: [0, -1, 0, -1, 5, -1, 0, -1, 0],
  },
  gaussian: {
    key: 'gaussian',
    label: 'Фильтр Гаусса 3x3',
    values: [1 / 16, 2 / 16, 1 / 16, 2 / 16, 4 / 16, 2 / 16, 1 / 16, 2 / 16, 1 / 16],
  },
  boxBlur: {
    key: 'boxBlur',
    label: 'Прямоугольное размытие',
    values: [1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9, 1 / 9],
  },
  prewittX: {
    key: 'prewittX',
    label: 'Прюитт X',
    values: [-1, 0, 1, -1, 0, 1, -1, 0, 1],
  },
  prewittY: {
    key: 'prewittY',
    label: 'Прюитт Y',
    values: [-1, -1, -1, 0, 0, 0, 1, 1, 1],
  },
};

const CHANNEL_INDEXES = {
  red: 0,
  green: 1,
  blue: 2,
  alpha: 3,
};

function clampByte(value) {
  return Math.min(Math.max(Math.round(value), 0), 255);
}

function clampCoordinate(value, max) {
  return Math.min(Math.max(value, 0), max);
}

function waitForFrame() {
  if (typeof requestAnimationFrame === 'function') {
    return new Promise((resolve) => requestAnimationFrame(resolve));
  }

  return new Promise((resolve) => setTimeout(resolve, 0));
}

function getEdgeValue(edgeHandling) {
  return edgeHandling === EDGE_HANDLING.white.key ? 255 : 0;
}

function getSample(source, width, height, x, y, channelOffset, edgeHandling) {
  if (x >= 0 && y >= 0 && x < width && y < height) {
    return source[(y * width + x) * 4 + channelOffset];
  }

  if (edgeHandling === EDGE_HANDLING.copy.key) {
    const safeX = clampCoordinate(x, width - 1);
    const safeY = clampCoordinate(y, height - 1);

    return source[(safeY * width + safeX) * 4 + channelOffset];
  }

  return getEdgeValue(edgeHandling);
}

export function normalizeKernelValues(values) {
  if (!Array.isArray(values) || values.length !== 9) {
    return null;
  }

  const kernel = values.map((value) => Number(value));

  return kernel.every(Number.isFinite) ? kernel : null;
}

export function getPresetKernel(presetKey) {
  const preset = KERNEL_PRESETS[presetKey] ?? KERNEL_PRESETS.identity;

  return [...preset.values];
}

export async function applyKernelToImageData(imageData, options) {
  const kernel = normalizeKernelValues(options.kernel);

  if (!kernel) {
    throw new Error('Ядро должно содержать 9 числовых значений.');
  }

  const selectedChannels = options.channels?.filter((channel) => channel in CHANNEL_INDEXES) ?? [];

  if (selectedChannels.length === 0) {
    throw new Error('Выберите хотя бы один канал для фильтрации.');
  }

  const edgeHandling = options.edgeHandling in EDGE_HANDLING ? options.edgeHandling : EDGE_HANDLING.copy.key;
  const result = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const source = imageData.data;
  const target = result.data;
  const channelOffsets = selectedChannels.map((channel) => CHANNEL_INDEXES[channel]);
  const { width, height } = imageData;
  const rowsPerFrame = options.rowsPerFrame ?? 24;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4;

      channelOffsets.forEach((channelOffset) => {
        let value = 0;

        for (let kernelY = 0; kernelY < 3; kernelY += 1) {
          for (let kernelX = 0; kernelX < 3; kernelX += 1) {
            const sourceX = x + kernelX - 1;
            const sourceY = y + kernelY - 1;
            const kernelValue = kernel[kernelY * 3 + kernelX];

            value += getSample(source, width, height, sourceX, sourceY, channelOffset, edgeHandling) * kernelValue;
          }
        }

        target[pixelIndex + channelOffset] = clampByte(value);
      });
    }

    if (y % rowsPerFrame === rowsPerFrame - 1) {
      await waitForFrame();
    }
  }

  return result;
}

export async function applyMedianFilterToImageData(imageData, options) {
  const selectedChannels = options.channels?.filter((channel) => channel in CHANNEL_INDEXES) ?? [];

  if (selectedChannels.length === 0) {
    throw new Error('Выберите хотя бы один канал для фильтрации.');
  }

  const edgeHandling = options.edgeHandling in EDGE_HANDLING ? options.edgeHandling : EDGE_HANDLING.copy.key;
  const result = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const source = imageData.data;
  const target = result.data;
  const channelOffsets = selectedChannels.map((channel) => CHANNEL_INDEXES[channel]);
  const { width, height } = imageData;
  const rowsPerFrame = options.rowsPerFrame ?? 24;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const pixelIndex = (y * width + x) * 4;

      channelOffsets.forEach((channelOffset) => {
        const values = [];

        for (let kernelY = 0; kernelY < 3; kernelY += 1) {
          for (let kernelX = 0; kernelX < 3; kernelX += 1) {
            values.push(getSample(source, width, height, x + kernelX - 1, y + kernelY - 1, channelOffset, edgeHandling));
          }
        }

        values.sort((left, right) => left - right);
        target[pixelIndex + channelOffset] = values[4];
      });
    }

    if (y % rowsPerFrame === rowsPerFrame - 1) {
      await waitForFrame();
    }
  }

  return result;
}
