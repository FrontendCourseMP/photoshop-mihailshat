import assert from 'node:assert/strict';
import { INTERPOLATION_METHODS, scaleImageData } from '../src/utils/interpolation.js';

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

const source = makeImageData(2, 2, [
  [0, 0, 0, 255],
  [100, 0, 0, 255],
  [0, 100, 0, 255],
  [100, 100, 0, 255],
]);

const nearest = scaleImageData(source, 3, 3, INTERPOLATION_METHODS.nearest.key);
assert.deepEqual(getPixel(nearest, 0, 0), [0, 0, 0, 255]);
assert.deepEqual(getPixel(nearest, 1, 1), [100, 100, 0, 255]);
assert.deepEqual(getPixel(nearest, 2, 2), [100, 100, 0, 255]);

const bilinear = scaleImageData(source, 3, 3, INTERPOLATION_METHODS.bilinear.key);
assert.deepEqual(getPixel(bilinear, 0, 0), [0, 0, 0, 255]);
assert.deepEqual(getPixel(bilinear, 1, 1), [50, 50, 0, 255]);
assert.deepEqual(getPixel(bilinear, 2, 2), [100, 100, 0, 255]);

const singlePixel = scaleImageData(source, 1, 1, INTERPOLATION_METHODS.bilinear.key);
assert.deepEqual(getPixel(singlePixel, 0, 0), [0, 0, 0, 255]);

console.log('Interpolation tests passed');
