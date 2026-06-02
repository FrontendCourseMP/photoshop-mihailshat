import {
  applyKernelToImageData,
  applyMedianFilterToImageData,
  normalizeKernelValues,
} from '../utils/kernels.js';

self.onmessage = async (event) => {
  const { id, width, height, buffer, mode, channels, edgeHandling, kernel } = event.data;

  try {
    const imageData = new ImageData(new Uint8ClampedArray(buffer), width, height);
    const options = { channels, edgeHandling, rowsPerFrame: 128 };
    const result =
      mode === 'median'
        ? await applyMedianFilterToImageData(imageData, options)
        : await applyKernelToImageData(imageData, {
            ...options,
            kernel: normalizeKernelValues(kernel),
          });
    const resultData = new Uint8ClampedArray(result.data);

    self.postMessage(
      {
        id,
        width: result.width,
        height: result.height,
        buffer: resultData.buffer,
      },
      [resultData.buffer],
    );
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : 'Не удалось применить фильтр.',
    });
  }
};
