import assert from 'node:assert/strict';
import {
  EDGE_HANDLING,
  KERNEL_PRESETS,
  applyKernelToImageData,
  applyMedianFilterToImageData,
  normalizeKernelValues,
} from '../src/utils/kernels.js';

class TestImageData {
  constructor(dataOrWidth, width, height) {
    if (typeof dataOrWidth === 'number') {
      this.width = dataOrWidth;
      this.height = width;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
      return;
    }

    this.data = dataOrWidth;
    this.width = width;
    this.height = height;
  }
}

globalThis.ImageData = TestImageData;

function makeImageData(width, height, pixels) {
  const imageData = new ImageData(width, height);

  pixels.forEach((pixel, index) => {
    imageData.data.set(pixel, index * 4);
  });

  return imageData;
}

function getPixel(imageData, x, y) {
  const index = (y * imageData.width + x) * 4;

  return Array.from(imageData.data.slice(index, index + 4));
}

assert.equal(normalizeKernelValues([1, 2, 3]), null);
assert.equal(normalizeKernelValues([1, 2, 3, 4, 5, 6, 7, 8, 'x']), null);
assert.deepEqual(normalizeKernelValues([1, 2, 3, 4, 5, 6, 7, 8, '9']), [1, 2, 3, 4, 5, 6, 7, 8, 9]);

const source = makeImageData(3, 3, [
  [10, 1, 1, 255],
  [20, 2, 2, 255],
  [30, 3, 3, 255],
  [40, 4, 4, 255],
  [50, 5, 5, 255],
  [60, 6, 6, 255],
  [70, 7, 7, 255],
  [80, 8, 8, 255],
  [90, 9, 9, 255],
]);

const identity = await applyKernelToImageData(source, {
  kernel: KERNEL_PRESETS.identity.values,
  channels: ['red', 'green', 'blue', 'alpha'],
  edgeHandling: EDGE_HANDLING.black.key,
  rowsPerFrame: 99,
});
assert.deepEqual(getPixel(identity, 1, 1), [50, 5, 5, 255]);

const redOnly = await applyKernelToImageData(source, {
  kernel: KERNEL_PRESETS.boxBlur.values,
  channels: ['red'],
  edgeHandling: EDGE_HANDLING.copy.key,
  rowsPerFrame: 99,
});
assert.deepEqual(getPixel(redOnly, 1, 1), [50, 5, 5, 255]);
assert.deepEqual(getPixel(redOnly, 0, 0), [23, 1, 1, 255]);

const grayChannel = await applyKernelToImageData(source, {
  kernel: KERNEL_PRESETS.boxBlur.values,
  channels: ['gray'],
  edgeHandling: EDGE_HANDLING.copy.key,
  rowsPerFrame: 99,
});
assert.deepEqual(getPixel(grayChannel, 0, 0), [23, 2, 2, 255]);

const blackEdge = await applyKernelToImageData(source, {
  kernel: KERNEL_PRESETS.boxBlur.values,
  channels: ['red'],
  edgeHandling: EDGE_HANDLING.black.key,
  rowsPerFrame: 99,
});
assert.deepEqual(getPixel(blackEdge, 0, 0), [13, 1, 1, 255]);

const noisy = makeImageData(3, 3, [
  [10, 1, 1, 255],
  [10, 1, 1, 255],
  [10, 1, 1, 255],
  [10, 1, 1, 255],
  [250, 1, 1, 255],
  [10, 1, 1, 255],
  [10, 1, 1, 255],
  [10, 1, 1, 255],
  [10, 1, 1, 255],
]);
const median = await applyMedianFilterToImageData(noisy, {
  channels: ['red'],
  edgeHandling: EDGE_HANDLING.copy.key,
  rowsPerFrame: 99,
});
assert.deepEqual(getPixel(median, 1, 1), [10, 1, 1, 255]);

await assert.rejects(
  () =>
    applyKernelToImageData(source, {
      kernel: KERNEL_PRESETS.identity.values,
      channels: [],
      edgeHandling: EDGE_HANDLING.copy.key,
    }),
  /Выберите хотя бы один канал/,
);

console.log('Kernel tests passed');
