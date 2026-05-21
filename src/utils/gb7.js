const SIGNATURE = [0x47, 0x42, 0x37, 0x1d];
const HEADER_SIZE = 12;
const CURRENT_VERSION = 0x01;

function checkSignature(bytes) {
  return SIGNATURE.every((value, index) => bytes[index] === value);
}

export function imageHasTransparency(imageData) {
  const { data } = imageData;

  for (let i = 3; i < data.length; i += 4) {
    if (data[i] < 255) {
      return true;
    }
  }

  return false;
}

export function decodeGb7(buffer) {
  const bytes = new Uint8Array(buffer);

  if (bytes.length < HEADER_SIZE) {
    throw new Error('Файл GB7 слишком короткий.');
  }

  if (!checkSignature(bytes)) {
    throw new Error('Сигнатура файла не совпадает с форматом GB7.');
  }

  const view = new DataView(buffer);
  const version = bytes[4];
  const flags = bytes[5];
  const hasMask = Boolean(flags & 0x01);
  const width = view.getUint16(6, false);
  const height = view.getUint16(8, false);
  const reserved = view.getUint16(10, false);
  const warnings = [];

  if (version !== CURRENT_VERSION) {
    throw new Error(`Версия GB7 ${version} не поддерживается.`);
  }

  if (flags & 0xfe) {
    throw new Error('В GB7-файле включены зарезервированные флаги.');
  }

  if (width === 0 || height === 0) {
    throw new Error('Размер изображения GB7 не может быть нулевым.');
  }

  if (reserved !== 0) {
    warnings.push('Зарезервированное поле заголовка не равно нулю.');
  }

  const pixelCount = width * height;
  const expectedLength = HEADER_SIZE + pixelCount;

  if (bytes.length < expectedLength) {
    throw new Error('В GB7-файле не хватает данных пикселей.');
  }

  if (bytes.length > expectedLength) {
    warnings.push('После изображения в файле есть лишние байты.');
  }

  const imageData = new ImageData(width, height);
  let unexpectedMaskBits = 0;

  for (let i = 0; i < pixelCount; i += 1) {
    const source = bytes[HEADER_SIZE + i];
    const gray7 = source & 0x7f;
    const gray8 = Math.round((gray7 / 127) * 255);
    const target = i * 4;

    if (!hasMask && (source & 0x80)) {
      unexpectedMaskBits += 1;
    }

    imageData.data[target] = gray8;
    imageData.data[target + 1] = gray8;
    imageData.data[target + 2] = gray8;
    imageData.data[target + 3] = hasMask ? (source & 0x80 ? 255 : 0) : 255;
  }

  if (unexpectedMaskBits > 0) {
    warnings.push('У части пикселей выставлен бит маски, хотя флаг маски выключен.');
  }

  return {
    imageData,
    width,
    height,
    hasMask,
    colorDepth: 7,
    warnings,
  };
}

export function encodeGb7(imageData, width, height, options = {}) {
  if (width > 65535 || height > 65535) {
    throw new Error('GB7 хранит ширину и высоту только до 65535 пикселей.');
  }

  const useMask = options.useMask ?? imageHasTransparency(imageData);
  const pixelCount = width * height;
  const bytes = new Uint8Array(HEADER_SIZE + pixelCount);
  const view = new DataView(bytes.buffer);

  SIGNATURE.forEach((value, index) => {
    bytes[index] = value;
  });

  bytes[4] = CURRENT_VERSION;
  bytes[5] = useMask ? 0x01 : 0x00;
  view.setUint16(6, width, false);
  view.setUint16(8, height, false);
  view.setUint16(10, 0, false);

  const { data } = imageData;

  for (let i = 0; i < pixelCount; i += 1) {
    const source = i * 4;
    const red = data[source];
    const green = data[source + 1];
    const blue = data[source + 2];
    const alpha = data[source + 3];
    const luma = red * 0.299 + green * 0.587 + blue * 0.114;
    const gray7 = Math.max(0, Math.min(127, Math.round((luma / 255) * 127)));
    const mask = useMask && alpha >= 128 ? 0x80 : 0x00;

    bytes[HEADER_SIZE + i] = mask | gray7;
  }

  return bytes.buffer;
}
