const ECL = { L: 0b01, M: 0b00, Q: 0b11, H: 0b10 };

const VERSIONS = [
  null,
  { version: 1, size: 21, dataCodewords: 16, ecPerBlock: 10, blocks: 1, align: [] },
  { version: 2, size: 25, dataCodewords: 28, ecPerBlock: 16, blocks: 1, align: [6, 18] },
  { version: 3, size: 29, dataCodewords: 44, ecPerBlock: 26, blocks: 1, align: [6, 22] },
  { version: 4, size: 33, dataCodewords: 64, ecPerBlock: 18, blocks: 2, align: [6, 26] },
];

const EXP = new Array(512);
const LOG = new Array(256);
{
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = value;
    LOG[value] = i;
    value <<= 1;
    if (value & 0x100) value ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

const gfMul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

function rsGenerator(degree) {
  let poly = [1];
  for (let i = 0; i < degree; i += 1) {
    const next = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  return poly;
}

function rsEncode(data, ecCount) {
  const generator = rsGenerator(ecCount);
  const remainder = new Array(ecCount).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder.shift();
    remainder.push(0);
    for (let i = 0; i < ecCount; i += 1) {
      remainder[i] ^= gfMul(generator[i + 1], factor);
    }
  }
  return remainder;
}

function pushBits(bits, length, value) {
  for (let i = length - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
}

function capacityBytes(version) {
  return Math.floor((VERSIONS[version].dataCodewords * 8 - 12) / 8);
}

function pickVersion(byteLength) {
  for (let version = 1; version < VERSIONS.length; version += 1) {
    if (byteLength <= capacityBytes(version)) return version;
  }
  return 0;
}

function dataCodewords(bytes, version) {
  const spec = VERSIONS[version];
  const bits = [];
  pushBits(bits, 4, 0b0100);
  pushBits(bits, 8, bytes.length);
  for (const byte of bytes) pushBits(bits, 8, byte);

  const capacityBits = spec.dataCodewords * 8;
  pushBits(bits, Math.min(4, capacityBits - bits.length), 0);
  while (bits.length % 8 !== 0) bits.push(0);

  const words = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(parseInt(bits.slice(i, i + 8).join(''), 2));
  }
  const pad = [0xec, 0x11];
  let index = 0;
  while (words.length < spec.dataCodewords) {
    words.push(pad[index % 2]);
    index += 1;
  }
  return words;
}

function splitBlocks(words, version) {
  const spec = VERSIONS[version];
  const shortLength = Math.floor(spec.dataCodewords / spec.blocks);
  const longCount = spec.dataCodewords % spec.blocks;
  const dataBlocks = [];
  const ecBlocks = [];
  let offset = 0;
  for (let i = 0; i < spec.blocks; i += 1) {
    const length = shortLength + (i >= spec.blocks - longCount ? 1 : 0);
    const block = words.slice(offset, offset + length);
    offset += length;
    dataBlocks.push(block);
    ecBlocks.push(rsEncode(block, spec.ecPerBlock));
  }
  return { dataBlocks, ecBlocks };
}

function interleave(dataBlocks, ecBlocks) {
  const output = [];
  const maxData = Math.max(...dataBlocks.map((block) => block.length));
  for (let i = 0; i < maxData; i += 1) {
    for (const block of dataBlocks) {
      if (i < block.length) output.push(block[i]);
    }
  }
  const maxEc = Math.max(...ecBlocks.map((block) => block.length));
  for (let i = 0; i < maxEc; i += 1) {
    for (const block of ecBlocks) {
      if (i < block.length) output.push(block[i]);
    }
  }
  return output;
}

function buildBase(size, align) {
  const matrix = Array.from({ length: size }, () => new Array(size).fill(false));
  const reserved = Array.from({ length: size }, () => new Array(size).fill(false));

  const set = (row, col, on) => {
    if (row < 0 || row >= size || col < 0 || col >= size) return;
    matrix[row][col] = on;
    reserved[row][col] = true;
  };

  const placeFinder = (row, col) => {
    for (let r = -1; r <= 7; r += 1) {
      for (let c = -1; c <= 7; c += 1) {
        const on =
          (r >= 0 && r <= 6 && (c === 0 || c === 6)) ||
          (c >= 0 && c <= 6 && (r === 0 || r === 6)) ||
          (r >= 2 && r <= 4 && c >= 2 && c <= 4);
        set(row + r, col + c, on);
      }
    }
  };

  placeFinder(0, 0);
  placeFinder(0, size - 7);
  placeFinder(size - 7, 0);

  for (let i = 8; i < size - 8; i += 1) {
    const on = i % 2 === 0;
    set(6, i, on);
    set(i, 6, on);
  }

  for (const row of align) {
    for (const col of align) {
      const overlapsFinder = (row === 6 && (col === 6 || col === size - 7)) || (col === 6 && row === size - 7);
      if (overlapsFinder) continue;
      for (let dr = -2; dr <= 2; dr += 1) {
        for (let dc = -2; dc <= 2; dc += 1) {
          set(row + dr, col + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
        }
      }
    }
  }

  for (let i = 0; i <= 8; i += 1) {
    if (i === 6) {
      set(8, 6, true);
      set(6, 8, true);
      continue;
    }
    set(8, i, false);
    set(i, 8, false);
  }
  for (let i = 0; i < 8; i += 1) set(8, size - 1 - i, false);
  for (let i = 0; i < 7; i += 1) set(size - 1 - i, 8, false);

  return { matrix, reserved };
}

const MASKS = [
  (row, col) => (row + col) % 2 === 0,
  (row) => row % 2 === 0,
  (row, col) => col % 3 === 0,
  (row, col) => (row + col) % 3 === 0,
  (row, col) => (Math.floor(row / 2) + Math.floor(col / 3)) % 2 === 0,
  (row, col) => ((row * col) % 2) + ((row * col) % 3) === 0,
  (row, col) => (((row * col) % 2) + ((row * col) % 3)) % 2 === 0,
  (row, col) => (((row + col) % 2) + ((row * col) % 3)) % 2 === 0,
];

function formatBits(ecl, mask) {
  const data = (ecl << 3) | mask;
  let remainder = data;
  for (let i = 0; i < 10; i += 1) {
    remainder = (remainder << 1) ^ ((remainder >> 9) * 0x537);
  }
  return (((data << 10) | remainder) ^ 0x5412) & 0x7fff;
}

function writeFormat(matrix, size, ecl, mask) {
  const bits = formatBits(ecl, mask);
  const bit = (index) => ((bits >> index) & 1) === 1;

  for (let i = 0; i <= 5; i += 1) matrix[i][8] = bit(i);
  matrix[7][8] = bit(6);
  matrix[8][8] = bit(7);
  matrix[8][7] = bit(8);
  for (let i = 9; i < 15; i += 1) matrix[8][14 - i] = bit(i);

  for (let i = 0; i < 8; i += 1) matrix[8][size - 1 - i] = bit(i);
  for (let i = 8; i < 15; i += 1) matrix[size - 15 + i][8] = bit(i);
  matrix[size - 8][8] = true;
}

function placeData(base, bits, maskIndex, size) {
  const matrix = base.matrix.map((row) => row.slice());
  const mask = MASKS[maskIndex];
  let index = 0;

  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vertical = 0; vertical < size; vertical += 1) {
      for (let offset = 0; offset < 2; offset += 1) {
        const col = right - offset;
        const upward = ((right + 1) & 2) === 0;
        const row = upward ? size - 1 - vertical : vertical;
        if (base.reserved[row][col]) continue;
        const raw = index < bits.length ? bits[index] : 0;
        index += 1;
        matrix[row][col] = (raw ^ (mask(row, col) ? 1 : 0)) === 1;
      }
    }
  }
  return matrix;
}

function penalty(matrix) {
  const size = matrix.length;
  let score = 0;

  for (let i = 0; i < size; i += 1) {
    let runColor = matrix[i][0];
    let run = 1;
    for (let j = 1; j < size; j += 1) {
      if (matrix[i][j] === runColor) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        runColor = matrix[i][j];
        run = 1;
      }
    }
    runColor = matrix[0][i];
    run = 1;
    for (let j = 1; j < size; j += 1) {
      if (matrix[j][i] === runColor) {
        run += 1;
        if (run === 5) score += 3;
        else if (run > 5) score += 1;
      } else {
        runColor = matrix[j][i];
        run = 1;
      }
    }
  }

  for (let i = 0; i < size - 1; i += 1) {
    for (let j = 0; j < size - 1; j += 1) {
      const color = matrix[i][j];
      if (color === matrix[i][j + 1] && color === matrix[i + 1][j] && color === matrix[i + 1][j + 1]) {
        score += 3;
      }
    }
  }

  const forward = [true, false, true, true, true, false, true, false, false, false, false];
  const backward = forward.slice().reverse();
  for (let i = 0; i < size; i += 1) {
    for (let j = 0; j + 11 <= size; j += 1) {
      let rowForward = true;
      let rowBackward = true;
      let colForward = true;
      let colBackward = true;
      for (let k = 0; k < 11; k += 1) {
        if (matrix[i][j + k] !== forward[k]) rowForward = false;
        if (matrix[i][j + k] !== backward[k]) rowBackward = false;
        if (matrix[j + k][i] !== forward[k]) colForward = false;
        if (matrix[j + k][i] !== backward[k]) colBackward = false;
      }
      if (rowForward) score += 40;
      if (rowBackward) score += 40;
      if (colForward) score += 40;
      if (colBackward) score += 40;
    }
  }

  let dark = 0;
  for (const row of matrix) {
    for (const cell of row) if (cell) dark += 1;
  }
  const ratio = (dark * 100) / (size * size);
  score += Math.floor(Math.abs(ratio - 50) / 5) * 10;

  return score;
}

export function createQrMatrix(text, { ecl = 'M', mask: forcedMask = null } = {}) {
  const bytes = [...new TextEncoder().encode(String(text))];
  const version = pickVersion(bytes.length);
  if (version === 0) {
    throw new Error(`qr_too_long: ${bytes.length} 字节超出 V4-M 容量`);
  }
  const spec = VERSIONS[version];
  const words = dataCodewords(bytes, version);
  const { dataBlocks, ecBlocks } = splitBlocks(words, version);
  const codeWords = interleave(dataBlocks, ecBlocks);
  const bits = [];
  for (const word of codeWords) pushBits(bits, 8, word);

  const base = buildBase(spec.size, spec.align);
  const eclBits = ECL[ecl] ?? ECL.M;

  if (forcedMask !== null) {
    const matrix = placeData(base, bits, forcedMask, spec.size);
    writeFormat(matrix, spec.size, eclBits, forcedMask);
    return { version, size: spec.size, mask: forcedMask, modules: matrix, text: String(text) };
  }

  let best = null;
  let bestScore = Infinity;
  let bestMask = -1;
  for (let mask = 0; mask < 8; mask += 1) {
    const matrix = placeData(base, bits, mask, spec.size);
    writeFormat(matrix, spec.size, eclBits, mask);
    const score = penalty(matrix);
    if (score < bestScore) {
      bestScore = score;
      best = matrix;
      bestMask = mask;
    }
  }

  return {
    version,
    size: spec.size,
    mask: bestMask,
    modules: best,
    text: String(text),
  };
}

export function renderQrSvg(text, { moduleSize = 4, margin = 2, ecl = 'M' } = {}) {
  const { modules, size } = createQrMatrix(text, { ecl });
  const total = size + margin * 2;
  const parts = [];
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (modules[row][col]) parts.push(`M${col + margin} ${row + margin}h1v1h-1z`);
    }
  }
  return `<svg class="qr__svg" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="角色核对二维码"><rect width="${total}" height="${total}" fill="#efe7d8"/><path d="${parts.join('')}" fill="#191510"/></svg>`;
}

export function toMatrixText(text, options) {
  const { modules } = createQrMatrix(text, options);
  return modules.map((row) => row.map((cell) => (cell ? '1' : '0')).join('')).join('\n');
}

export const QR_LIMITS = Object.freeze({
  versions: VERSIONS.slice(1).map((spec) => ({ version: spec.version, size: spec.size, capacity: capacityBytes(spec.version) })),
});