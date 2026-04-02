const sharp = require('sharp');

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toHex(value) {
  return clamp(Math.round(value), 0, 255).toString(16).padStart(2, '0');
}

function luminance(r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

async function analyzeImageForLayout(imagePath) {
  const image = sharp(imagePath, { failOn: 'none' });
  const stats = await image.stats();
  const { data, info } = await image
    .resize(96, 54, { fit: 'cover' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const channels = info.channels || 3;
  const region = {
    left: { sum: 0, count: 0 },
    right: { sum: 0, count: 0 },
    top: { sum: 0, count: 0 },
    bottom: { sum: 0, count: 0 },
    center: { sum: 0, count: 0 },
  };

  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      const idx = (y * info.width + x) * channels;
      const r = data[idx];
      const g = data[idx + 1];
      const b = data[idx + 2];
      const luma = luminance(r, g, b);

      if (x < info.width / 2) {
        region.left.sum += luma;
        region.left.count++;
      } else {
        region.right.sum += luma;
        region.right.count++;
      }

      if (y < info.height / 2) {
        region.top.sum += luma;
        region.top.count++;
      } else {
        region.bottom.sum += luma;
        region.bottom.count++;
      }

      if (
        x > info.width * 0.28 &&
        x < info.width * 0.72 &&
        y > info.height * 0.24 &&
        y < info.height * 0.76
      ) {
        region.center.sum += luma;
        region.center.count++;
      }
    }
  }

  const avg = (entry) => entry.count ? entry.sum / entry.count : 0;
  const leftBrightness = avg(region.left);
  const rightBrightness = avg(region.right);
  const topBrightness = avg(region.top);
  const bottomBrightness = avg(region.bottom);
  const centerBrightness = avg(region.center);

  const red = stats.channels[0]?.mean || 0;
  const green = stats.channels[1]?.mean || 0;
  const blue = stats.channels[2]?.mean || 0;
  const overallBrightness = luminance(red, green, blue);
  const contrast = (
    (stats.channels[0]?.stdev || 0) +
    (stats.channels[1]?.stdev || 0) +
    (stats.channels[2]?.stdev || 0)
  ) / 3;

  let safestTextPlacement = 'left';
  if (Math.abs(leftBrightness - rightBrightness) > 12) {
    safestTextPlacement = leftBrightness < rightBrightness ? 'left' : 'right';
  } else if (Math.abs(topBrightness - bottomBrightness) > 10) {
    safestTextPlacement = topBrightness < bottomBrightness ? 'top' : 'bottom';
  }

  const recommendedTextTone = overallBrightness > 138 ? 'dark' : 'light';
  const recommendedOverlay = clamp(
    recommendedTextTone === 'light'
      ? 0.34 + (contrast < 42 ? 0.16 : 0.06)
      : 0.16 + (contrast > 54 ? 0.08 : 0.02),
    0.12,
    0.68
  );

  return {
    imagePath,
    size: { width: info.width, height: info.height },
    averageColor: `#${toHex(red)}${toHex(green)}${toHex(blue)}`,
    overallBrightness: Math.round(overallBrightness),
    contrast: Math.round(contrast),
    quadrantBrightness: {
      left: Math.round(leftBrightness),
      right: Math.round(rightBrightness),
      top: Math.round(topBrightness),
      bottom: Math.round(bottomBrightness),
      center: Math.round(centerBrightness),
    },
    safestTextPlacement,
    recommendedTextTone,
    recommendedOverlay: Number(recommendedOverlay.toFixed(2)),
    summary: [
      `average color ${`#${toHex(red)}${toHex(green)}${toHex(blue)}`}`,
      `brightness ${Math.round(overallBrightness)}`,
      `contrast ${Math.round(contrast)}`,
      `darker side ${safestTextPlacement}`,
      `recommended ${recommendedTextTone} text`
    ].join(', ')
  };
}

async function analyzePagesForLayout(pages = []) {
  const analyses = [];
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page?.bgImagePath) {
      analyses.push(null);
      continue;
    }
    try {
      analyses.push(await analyzeImageForLayout(page.bgImagePath));
    } catch (err) {
      analyses.push({
        imagePath: page.bgImagePath,
        summary: `analysis failed: ${err.message}`,
        safestTextPlacement: 'left',
        recommendedTextTone: 'light',
        recommendedOverlay: 0.42
      });
    }
  }
  return analyses;
}

function colorDistance(hexA, hexB) {
  const parse = (hex) => {
    const value = String(hex || '').replace('#', '');
    if (value.length !== 6) return [0, 0, 0];
    return [
      parseInt(value.slice(0, 2), 16),
      parseInt(value.slice(2, 4), 16),
      parseInt(value.slice(4, 6), 16),
    ];
  };
  const [r1, g1, b1] = parse(hexA);
  const [r2, g2, b2] = parse(hexB);
  return Math.sqrt(
    Math.pow(r1 - r2, 2) +
    Math.pow(g1 - g2, 2) +
    Math.pow(b1 - b2, 2)
  );
}

module.exports = {
  analyzeImageForLayout,
  analyzePagesForLayout,
  colorDistance,
};
