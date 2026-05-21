export const SCALE_LIMITS = {
  min: 12,
  max: 300,
};

export const INTERPOLATION_METHODS = {
  nearest: {
    key: 'nearest',
    label: 'Ближайший сосед',
    description: 'Быстрый метод без смешивания цветов. Хорошо подходит для пиксельной графики и резких краев.',
  },
  bilinear: {
    key: 'bilinear',
    label: 'Билинейная',
    description: 'Смешивает четыре соседних пикселя. Дает более плавный результат при увеличении и уменьшении.',
  },
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getPixel(data, width, height, x, y) {
  const safeX = clamp(x, 0, width - 1);
  const safeY = clamp(y, 0, height - 1);
  const index = (safeY * width + safeX) * 4;

  return [data[index], data[index + 1], data[index + 2], data[index + 3]];
}

function setPixel(data, width, x, y, pixel) {
  const index = (y * width + x) * 4;

  data[index] = pixel[0];
  data[index + 1] = pixel[1];
  data[index + 2] = pixel[2];
  data[index + 3] = pixel[3];
}

function nearestSample(sourceData, sourceWidth, sourceHeight, sourceX, sourceY) {
  return getPixel(sourceData, sourceWidth, sourceHeight, Math.round(sourceX), Math.round(sourceY));
}

function bilinearSample(sourceData, sourceWidth, sourceHeight, sourceX, sourceY) {
  const x0 = Math.floor(sourceX);
  const y0 = Math.floor(sourceY);
  const x1 = x0 + 1;
  const y1 = y0 + 1;
  const dx = sourceX - x0;
  const dy = sourceY - y0;
  const topLeft = getPixel(sourceData, sourceWidth, sourceHeight, x0, y0);
  const topRight = getPixel(sourceData, sourceWidth, sourceHeight, x1, y0);
  const bottomLeft = getPixel(sourceData, sourceWidth, sourceHeight, x0, y1);
  const bottomRight = getPixel(sourceData, sourceWidth, sourceHeight, x1, y1);

  return [0, 1, 2, 3].map((channel) => {
    const top = topLeft[channel] * (1 - dx) + topRight[channel] * dx;
    const bottom = bottomLeft[channel] * (1 - dx) + bottomRight[channel] * dx;

    return Math.round(top * (1 - dy) + bottom * dy);
  });
}

function getSampler(method) {
  if (method === INTERPOLATION_METHODS.nearest.key) {
    return nearestSample;
  }

  return bilinearSample;
}

export function clampScale(scale) {
  return clamp(Math.round(scale), SCALE_LIMITS.min, SCALE_LIMITS.max);
}

export function scaleImageData(imageData, targetWidth, targetHeight, method = INTERPOLATION_METHODS.bilinear.key) {
  const width = Math.max(1, Math.round(targetWidth));
  const height = Math.max(1, Math.round(targetHeight));
  const result = new ImageData(width, height);
  const sampler = getSampler(method);
  const sourceWidth = imageData.width;
  const sourceHeight = imageData.height;
  const xRatio = width > 1 ? (sourceWidth - 1) / (width - 1) : 0;
  const yRatio = height > 1 ? (sourceHeight - 1) / (height - 1) : 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const sourceX = x * xRatio;
      const sourceY = y * yRatio;
      const pixel = sampler(imageData.data, sourceWidth, sourceHeight, sourceX, sourceY);

      setPixel(result.data, width, x, y, pixel);
    }
  }

  return result;
}

