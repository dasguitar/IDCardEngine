/* ID Card Design Engine - Scoped Javascript */

// Self-contained, pure JS QR Code generator (Model 2, Level M)
const QRCodeGenerator = (function() {
  const gfExp = new Uint8Array(512);
  const gfLog = new Uint8Array(256);
  let gfInitialized = false;

  function initGF() {
    if (gfInitialized) return;
    let x = 1;
    for (let i = 0; i < 255; i++) {
      gfExp[i] = x;
      gfLog[x] = i;
      x = (x << 1) ^ (x & 0x80 ? 285 : 0);
    }
    for (let i = 255; i < 512; i++) {
      gfExp[i] = gfExp[i - 255];
    }
    gfInitialized = true;
  }

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return gfExp[gfLog[a] + gfLog[b]];
  }

  function gfPolyMul(p1, p2) {
    const result = new Uint8Array(p1.length + p2.length - 1);
    for (let i = 0; i < p1.length; i++) {
      for (let j = 0; j < p2.length; j++) {
        result[i + j] ^= gfMul(p1[i], p2[j]);
      }
    }
    return result;
  }

  function gfPolyDiv(dividend, divisor) {
    const result = new Uint8Array(dividend);
    for (let i = 0; i < dividend.length - divisor.length + 1; i++) {
      const coef = result[i];
      if (coef !== 0) {
        for (let j = 0; j < divisor.length; j++) {
          result[i + j] ^= gfMul(divisor[j], coef);
        }
      }
    }
    return result.subarray(dividend.length - divisor.length + 1);
  }

  function getGeneratorPoly(numECBytes) {
    let g = new Uint8Array([1]);
    for (let i = 0; i < numECBytes; i++) {
      g = gfPolyMul(g, new Uint8Array([1, gfExp[i]]));
    }
    return g;
  }

  const VERSION_TABLE = [
    null,
    [26, 16, 10, 1], // V1 (21x21)
    [44, 28, 16, 1], // V2 (25x25)
    [70, 44, 26, 1], // V3 (29x29)
    [100, 64, 36, 2], // V4 (33x33)
    [134, 86, 48, 2], // V5 (37x37)
    [172, 108, 64, 4]  // V6 (41x41)
  ];

  const ALIGN_PATTERNS = [
    [], [], [6, 18], [6, 22], [6, 26], [6, 30], [6, 34]
  ];
  
  const FORMAT_INFOS = [
    0x5412, 0x5125, 0x5E7C, 0x5B4B, 0x45F9, 0x40CE, 0x4F97, 0x4AA0
  ];

  const MASKS = [
    (x, y) => (x + y) % 2 === 0,
    (x, y) => y % 2 === 0,
    (x, y) => x % 3 === 0,
    (x, y) => (x + y) % 3 === 0,
    (x, y) => (Math.floor(y / 2) + Math.floor(x / 3)) % 2 === 0,
    (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
    (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
    (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0
  ];

  return {
    generate(text) {
      initGF();
      let version = 1;
      let dataBytes = new TextEncoder().encode(text);
      let found = false;
      for (let v = 1; v <= 6; v++) {
        const capacity = VERSION_TABLE[v][1] - 3;
        if (dataBytes.length <= capacity) {
          version = v;
          found = true;
          break;
        }
      }
      if (!found) {
        version = 6;
        dataBytes = dataBytes.subarray(0, VERSION_TABLE[6][1] - 3);
      }

      const info = VERSION_TABLE[version];
      const totalBytes = info[0];
      const totalDataBytes = info[1];
      const totalECBytes = info[2];
      const numBlocks = info[3];

      let bitstream = [];
      function pushBits(val, numBits) {
        for (let i = numBits - 1; i >= 0; i--) {
          bitstream.push((val >> i) & 1);
        }
      }

      pushBits(4, 4); // Byte Mode
      pushBits(dataBytes.length, 8);
      for (let i = 0; i < dataBytes.length; i++) {
        pushBits(dataBytes[i], 8);
      }

      pushBits(0, Math.min(4, totalDataBytes * 8 - bitstream.length));
      while (bitstream.length % 8 !== 0) bitstream.push(0);

      const padBytes = [0xEC, 0x11];
      let padIdx = 0;
      while (bitstream.length < totalDataBytes * 8) {
        pushBits(padBytes[padIdx], 8);
        padIdx = (padIdx + 1) % 2;
      }

      const rawDataBytes = new Uint8Array(totalDataBytes);
      for (let i = 0; i < totalDataBytes; i++) {
        let b = 0;
        for (let j = 0; j < 8; j++) b = (b << 1) | bitstream[i * 8 + j];
        rawDataBytes[i] = b;
      }

      const ecBytesPerBlock = totalECBytes / numBlocks;
      const dataBytesPerBlock = totalDataBytes / numBlocks;
      const blocks = [];
      const ecBlocks = [];
      const g = getGeneratorPoly(ecBytesPerBlock);

      for (let b = 0; b < numBlocks; b++) {
        const blockData = rawDataBytes.subarray(b * dataBytesPerBlock, (b + 1) * dataBytesPerBlock);
        blocks.push(blockData);
        const paddedData = new Uint8Array(dataBytesPerBlock + ecBytesPerBlock);
        paddedData.set(blockData);
        ecBlocks.push(gfPolyDiv(paddedData, g));
      }

      const interleaved = new Uint8Array(totalBytes);
      let idx = 0;
      for (let i = 0; i < dataBytesPerBlock; i++) {
        for (let b = 0; b < numBlocks; b++) interleaved[idx++] = blocks[b][i];
      }
      for (let i = 0; i < ecBytesPerBlock; i++) {
        for (let b = 0; b < numBlocks; b++) interleaved[idx++] = ecBlocks[b][i];
      }

      const size = 4 * version + 17;
      const grid = Array(size).fill(0).map(() => Array(size).fill(0));
      const reserved = Array(size).fill(0).map(() => Array(size).fill(false));

      function drawFinder(ox, oy) {
        for (let y = -1; y <= 7; y++) {
          for (let x = -1; x <= 7; x++) {
            const px = ox + x;
            const py = oy + y;
            if (px >= 0 && px < size && py >= 0 && py < size) {
              reserved[py][px] = true;
              if (x >= 0 && x <= 6 && y >= 0 && y <= 6) {
                const isBorder = (x === 0 || x === 6 || y === 0 || y === 6);
                const isCenter = (x >= 2 && x <= 4 && y >= 2 && y <= 4);
                grid[py][px] = (isBorder || isCenter) ? 2 : 1;
              } else {
                grid[py][px] = 1;
              }
            }
          }
        }
      }
      drawFinder(0, 0);
      drawFinder(size - 7, 0);
      drawFinder(0, size - 7);

      for (let i = 8; i < size - 8; i++) {
        grid[6][i] = (i % 2 === 0) ? 2 : 1;
        reserved[6][i] = true;
        grid[i][6] = (i % 2 === 0) ? 2 : 1;
        reserved[i][6] = true;
      }

      const alignCoords = ALIGN_PATTERNS[version];
      for (let i = 0; i < alignCoords.length; i++) {
        for (let j = 0; j < alignCoords.length; j++) {
          const cx = alignCoords[i];
          const cy = alignCoords[j];
          if ((cx < 10 && cy < 10) || (cx > size - 10 && cy < 10) || (cx < 10 && cy > size - 10)) continue;

          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              grid[cy + dy][cx + dx] = (Math.max(Math.abs(dx), Math.abs(dy)) === 1) ? 1 : 2;
              reserved[cy + dy][cx + dx] = true;
            }
          }
        }
      }

      grid[4 * version + 9][8] = 2;
      reserved[4 * version + 9][8] = true;

      for (let i = 0; i < 9; i++) {
        reserved[8][i] = true;
        reserved[i][8] = true;
      }
      for (let i = 0; i < 8; i++) {
        reserved[size - 1 - i][8] = true;
        reserved[8][size - 1 - i] = true;
      }

      let interleavedBits = [];
      for (let i = 0; i < interleaved.length; i++) {
        const val = interleaved[i];
        for (let b = 7; b >= 0; b--) interleavedBits.push((val >> b) & 1);
      }

      let bitIdx = 0;
      let dir = -1;
      let x = size - 1;
      while (x > 0) {
        if (x === 6) x--;
        for (let yTemp = 0; yTemp < size; yTemp++) {
          const y = (dir === -1) ? (size - 1 - yTemp) : yTemp;
          for (let col = 0; col < 2; col++) {
            const px = x - col;
            if (!reserved[y][px]) {
              const bit = (bitIdx < interleavedBits.length) ? interleavedBits[bitIdx++] : 0;
              grid[y][px] = bit ? 2 : 1;
            }
          }
        }
        dir = -dir;
        x -= 2;
      }

      const selectedMask = 1;
      const maskFn = MASKS[selectedMask];
      const finalGrid = Array(size).fill(0).map(() => Array(size).fill(false));
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (reserved[y][x]) {
            finalGrid[y][x] = (grid[y][x] === 2);
          } else {
            finalGrid[y][x] = (grid[y][x] === 2) ^ maskFn(x, y);
          }
        }
      }

      const formatBitsValue = FORMAT_INFOS[selectedMask];
      const formatBits = [];
      for (let i = 0; i < 15; i++) formatBits.push((formatBitsValue >> i) & 1);

      for (let i = 0; i < 15; i++) {
        const val = (formatBits[i] === 1);
        
        // vertical
        if (i < 6) {
          finalGrid[i][8] = val;
        } else if (i < 8) {
          finalGrid[i + 1][8] = val;
        } else {
          finalGrid[size - 15 + i][8] = val;
        }

        // horizontal
        if (i < 8) {
          finalGrid[8][size - i - 1] = val;
        } else if (i < 9) {
          finalGrid[8][15 - i - 1 + 1] = val;
        } else {
          finalGrid[8][15 - i - 1] = val;
        }
      }

      // fixed dark module
      finalGrid[size - 8][8] = true;

      return finalGrid;
    },

    toSVGString(text, color = '#000000') {
      const grid = this.generate(text);
      const size = grid.length;
      const pad = 4; // Quiet zone size (standard is 4 modules)
      const totalSize = size + pad * 2;
      let svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${totalSize} ${totalSize}" shape-rendering="crispEdges">`;
      svg += `<rect width="${totalSize}" height="${totalSize}" fill="#ffffff"/>`;
      svg += `<path fill="${color}" d="`;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          if (grid[y][x]) {
            svg += `M${x + pad} ${y + pad}h1v1h-1z `;
          }
        }
      }
      svg += `"/></svg>`;
      return svg;
    }
  };
})();

const createDefaultSchoolLogo = () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50" width="50" height="50">
      <path d="M 25 5 L 42 12 L 42 30 C 42 40, 25 47, 25 47 C 25 47, 8 40, 8 30 L 8 12 Z" fill="#3b82f6"/>
      <path d="M 25 8 L 39 14 L 39 29 C 39 37, 25 43, 25 43 C 25 43, 11 37, 11 29 L 11 14 Z" fill="#ffffff"/>
      <polygon points="25,15 32,28 18,28" fill="#3b82f6"/>
      <circle cx="25" cy="22" r="3" fill="#ffffff"/>
    </svg>
  `.trim();
  return 'data:image/svg+xml;base64,' + btoa(svg);
};

const createDefaultAvatarBase64 = () => {
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 120" width="100" height="120">
      <rect width="100" height="120" fill="#f1f5f9"/>
      <circle cx="50" cy="45" r="20" fill="#cbd5e1"/>
      <path d="M 20 100 C 20 80, 80 80, 80 100" fill="#cbd5e1"/>
      <rect x="2" y="2" width="96" height="116" fill="none" stroke="#cbd5e1" stroke-width="2" stroke-dasharray="4"/>
    </svg>
  `.trim();
  return 'data:image/svg+xml;base64,' + btoa(svg);
};

// Core ID Card Printing and Designing Engine
class IDCardEngine {
  constructor(configOrTemplates) {
    let config = {};
    if (Array.isArray(configOrTemplates)) {
      config = {
        templates: configOrTemplates,
        target: '#id-designer-container'
      };
    } else {
      config = configOrTemplates || {};
    }

    const targetSelector = config.target || '#id-designer-container';
    this.target = document.querySelector(targetSelector);
    if (!this.target) {
      throw new Error(`IDCardEngine: Target container "${targetSelector}" not found.`);
    }

    this.templates = config.templates || [];
    this.onSave = config.onSave || ((schema) => {
      const event = new CustomEvent('idcardengine:save', { detail: schema });
      window.dispatchEvent(event);
    });
    this.onChange = config.onChange || ((engine) => {
      const event = new CustomEvent('idcardengine:change', { detail: engine });
      window.dispatchEvent(event);
    });
    this.onPrintPreview = config.onPrintPreview || ((engine) => {
      engine.renderPrintPreview({
        layoutSchema: engine.layout,
        cardHolderData: engine.designerPlaceholderData
      });
    });

    // Initial Layout Schema State
    this.layout = config.layout || this.loadDefaultLayout();
    this.saveUrl = config.saveUrl || null;
    this.layoutTemplates = [];
    this.activeLayoutId = 'tpl_default';
    this.activeSide = 'front';
    this.selectedElementId = null;
    this.activeGalleryCategory = 'All Templates'; // Default gallery tab filter
    
    // Drag & Resize State
    this.isDragging = false;
    this.isResizing = false;
    this.dragStart = { x: 0, y: 0 };
    this.elementStart = { x: 0, y: 0, w: 0, h: 0 };
    this.resizeDirection = ''; // 'se', 'sw', etc.

    // Preloaded designer placeholder data
    this.designerPlaceholderData = {
      id: "STU-2026-9999",
      id_number: "STU-2026-9999",
      name: "John Doe",
      role: "Student",
      program: "Computer Science",
      dob: "2005-08-14",
      validYears: "2026 - 2030",
      valid_years: "2026 - 2030",
      photoUrl: "", // Base64 placeholder or empty will trigger SVG outline
      signatureUrl: "", // Base64 placeholder or empty will trigger signature icon
      schoolLogoUrl: createDefaultSchoolLogo(),
      schoolName: "Acme Academy",
      school_name: "Acme Academy"
    };

    this.init();
  }

  loadDefaultLayout() {
    const defaultFront = this.templates && this.templates.find(t => t.id === 'tpl_blue_front');
    const defaultBack = this.templates && this.templates.find(t => t.id === 'tpl_dark_back');

    return {
      orientation: 'portrait',
      elements: [
        {
          id: 'school_logo',
          name: 'School Logo',
          side: 'front',
          x: 6.0,
          y: 4.0,
          width: 12.0,
          height: 8.0,
          visible: true
        },
        {
          id: 'school_name',
          name: 'School Name',
          side: 'front',
          x: 20.0,
          y: 5.0,
          width: 74.0,
          fontSize: 3.2,
          fontColor: '#ffffff',
          fontWeight: 'bold',
          fontStyle: 'normal',
          textAlign: 'left',
          visible: true
        },
        {
          id: 'photo',
          name: 'Student/Staff Photo',
          side: 'front',
          x: 30.0,
          y: 15.0,
          width: 40.0,
          height: 28.0,
          visible: true
        },
        {
          id: 'name',
          name: 'Full Name',
          side: 'front',
          x: 5.0,
          y: 45.0,
          width: 90.0,
          fontSize: 4.2,
          fontColor: '#0f172a',
          fontWeight: 'bold',
          fontStyle: 'normal',
          textAlign: 'center',
          visible: true
        },
        {
          id: 'role',
          name: 'Class / Role',
          side: 'front',
          x: 5.0,
          y: 52.0,
          width: 90.0,
          fontSize: 3.2,
          fontColor: '#2563eb',
          fontWeight: 'bold',
          fontStyle: 'normal',
          textAlign: 'center',
          visible: true
        },
        {
          id: 'id_number',
          name: 'ID Number',
          side: 'front',
          x: 6.0,
          y: 61.0,
          width: 52.0,
          fontSize: 2.8,
          fontColor: '#475569',
          fontWeight: 'bold',
          fontStyle: 'normal',
          textAlign: 'left',
          visible: true
        },
        {
          id: 'program',
          name: 'Program / Department',
          side: 'front',
          x: 6.0,
          y: 68.0,
          width: 52.0,
          fontSize: 2.4,
          fontColor: '#475569',
          fontWeight: 'normal',
          fontStyle: 'normal',
          textAlign: 'left',
          visible: true
        },
        {
          id: 'dob',
          name: 'Date of Birth',
          side: 'front',
          x: 6.0,
          y: 75.0,
          width: 52.0,
          fontSize: 2.4,
          fontColor: '#475569',
          fontWeight: 'normal',
          fontStyle: 'normal',
          textAlign: 'left',
          visible: true
        },
        {
          id: 'valid_years',
          name: 'Valid Range of Years',
          side: 'front',
          x: 6.0,
          y: 82.0,
          width: 52.0,
          fontSize: 2.4,
          fontColor: '#475569',
          fontWeight: 'normal',
          fontStyle: 'normal',
          textAlign: 'left',
          visible: true
        },
        {
          id: 'qr_code',
          name: 'QR Code',
          side: 'front',
          x: 64.0,
          y: 61.0,
          width: 30.0,
          height: 19.0,
          fontColor: '#000000',
          visible: true
        },
        {
          id: 'custom_text_1',
          name: 'Instructions Block',
          side: 'back',
          x: 10.0,
          y: 58.0,
          width: 80.0,
          height: 20.0,
          fontSize: 2.4,
          fontColor: '#475569',
          fontWeight: 'normal',
          fontStyle: 'italic',
          textAlign: 'center',
          visible: true,
          isCustom: true,
          text: "This card is the property of the issuing institution. If found, please return to the administration office."
        } ,
        {
          id: 'signature',
          name: 'Dean Signature',
          side: 'back',
          x: 30.0,
          y: 25.0,
          width: 40.0,
          height: 12.0,
          visible: true
        }
      ],
      backgrounds: {
        front: {
          type: defaultFront ? 'image' : 'color',
          value: defaultFront ? defaultFront.bgUrl : '#f8fafc',
          templateId: defaultFront ? 'tpl_blue_front' : ''
        },
        back: {
          type: defaultBack ? 'image' : 'color',
          value: defaultBack ? defaultBack.bgUrl : '#ffffff',
          templateId: defaultBack ? 'tpl_dark_back' : ''
        }
      }
    };
  }

  loadLayout(layoutSchema) {
    if (!layoutSchema || typeof layoutSchema !== 'object') {
      console.error("IDCardEngine: Invalid layout schema configuration.", layoutSchema);
      return;
    }
    this.layout = layoutSchema;
    this.selectedElementId = null;
    this.activeSide = 'front';
    this.refreshDesignerCanvas();
    if (this.onChange) this.onChange(this);
    console.log("IDCardEngine: Layout loaded successfully.", this.layout);
  }

  addElementToCard(type) {
    const side = this.activeSide;
    
    const defaults = {
      photo: {
        id: 'photo',
        name: 'Photo Field',
        side: side,
        x: 35.0,
        y: 20.0,
        width: 30.0,
        height: 38.0,
        visible: true
      },
      school_logo: {
        id: 'school_logo',
        name: 'School Logo',
        side: side,
        x: 40.0,
        y: 5.0,
        width: 20.0,
        height: 12.0,
        visible: true
      },
      school_name: {
        id: 'school_name',
        name: 'School Name',
        side: side,
        x: 10.0,
        y: 10.0,
        width: 80.0,
        height: 8.0,
        fontSize: 3.5,
        fontColor: '#1e3a8a',
        fontWeight: 'bold',
        textAlign: 'center',
        visible: true
      },
      name: {
        id: 'name',
        name: 'Student Name',
        side: side,
        x: 10.0,
        y: 60.0,
        width: 80.0,
        height: 6.0,
        fontSize: 4.0,
        fontColor: '#1e293b',
        fontWeight: 'bold',
        textAlign: 'center',
        visible: true
      },
      id_number: {
        id: 'id_number',
        name: 'Student ID',
        side: side,
        x: 10.0,
        y: 68.0,
        width: 80.0,
        height: 5.0,
        fontSize: 3.0,
        fontColor: '#64748b',
        fontWeight: 'bold',
        textAlign: 'center',
        visible: true
      },
      program: {
        id: 'program',
        name: 'Program Field',
        side: side,
        x: 10.0,
        y: 74.0,
        width: 80.0,
        height: 5.0,
        fontSize: 3.0,
        fontColor: '#475569',
        fontWeight: 'normal',
        textAlign: 'center',
        visible: true
      },
      role: {
        id: 'role',
        name: 'Role Badge',
        side: side,
        x: 40.0,
        y: 80.0,
        width: 20.0,
        height: 5.0,
        fontSize: 2.5,
        fontColor: '#ffffff',
        fontWeight: 'bold',
        textAlign: 'center',
        visible: true
      },
      dob: {
        id: 'dob',
        name: 'DOB Field',
        side: side,
        x: 10.0,
        y: 87.0,
        width: 80.0,
        height: 5.0,
        fontSize: 2.5,
        fontColor: '#64748b',
        fontWeight: 'normal',
        textAlign: 'center',
        visible: true
      },
      valid_years: {
        id: 'valid_years',
        name: 'Valid Years',
        side: side,
        x: 10.0,
        y: 92.0,
        width: 80.0,
        height: 5.0,
        fontSize: 2.5,
        fontColor: '#64748b',
        fontWeight: 'normal',
        textAlign: 'center',
        visible: true
      },
      signature: {
        id: 'signature',
        name: 'Dean Signature',
        side: side,
        x: 30.0,
        y: 40.0,
        width: 40.0,
        height: 12.0,
        visible: true
      }
    };

    let targetEl = null;

    if (type === 'custom_text') {
      const id = 'text_' + Date.now();
      targetEl = {
        id: id,
        name: 'Custom Text Block',
        side: side,
        x: 10.0,
        y: 45.0,
        width: 80.0,
        height: 6.0,
        fontSize: 3.0,
        fontColor: '#000000',
        fontWeight: 'normal',
        fontStyle: 'normal',
        textAlign: 'center',
        visible: true,
        isCustom: true,
        text: "Custom Text Block"
      };
      this.layout.elements.push(targetEl);
    } else if (type === 'custom_qr') {
      const id = 'qr_code_' + Date.now();
      targetEl = {
        id: id,
        name: 'Custom QR Code',
        side: side,
        x: 42.5,
        y: 45.0,
        width: 15.0,
        height: 15.0,
        visible: true
      };
      this.layout.elements.push(targetEl);
    } else if (defaults[type]) {
      const existing = this.layout.elements.find(el => el.id === type);
      if (existing) {
        existing.visible = true;
        existing.side = side;
        existing.x = defaults[type].x;
        existing.y = defaults[type].y;
        targetEl = existing;
      } else {
        targetEl = Object.assign({}, defaults[type]);
        this.layout.elements.push(targetEl);
      }
    }

    if (targetEl) {
      this.selectedElementId = targetEl.id;
      this.refreshDesignerCanvas();
      if (this.onChange) this.onChange(this);
    }
  }

  fetchLayoutTemplates() {
    if (!this.saveUrl) return;
    fetch(this.saveUrl)
      .then(response => response.json())
      .then(data => {
        if (data.status === 'success' && data.templates) {
          this.layoutTemplates = data.templates;
          this.updateLayoutTemplatesDropdown();
        }
      })
      .catch(err => console.error("IDCardEngine: Failed to fetch layout templates.", err));
  }

  updateLayoutTemplatesDropdown() {
    const select = this.target.querySelector("#id-engine-layout-select");
    if (!select) return;
    
    const prevVal = this.activeLayoutId || 'tpl_default';
    select.innerHTML = '';
    
    this.layoutTemplates.forEach(t => {
      const opt = document.createElement("option");
      opt.value = t.id;
      opt.textContent = t.category ? `${t.name} (${t.category})` : t.name;
      select.appendChild(opt);
    });
    
    select.value = prevVal;
    
    const activeTpl = this.layoutTemplates.find(t => t.id === prevVal);
    const nameInput = this.target.querySelector("#id-engine-layout-name-input");
    if (nameInput && activeTpl) {
      nameInput.value = activeTpl.name;
    }
    const categorySelect = this.target.querySelector("#id-engine-layout-category-select");
    if (categorySelect && activeTpl) {
      categorySelect.value = activeTpl.category || 'Student ID';
    }
  }

  init() {
    this.renderUI();
    this.bindEvents();
    this.refreshDesignerCanvas();
    this.fetchLayoutTemplates();
  }

  // 1. Render Editor Dashboard Layout
  renderUI() {
    this.target.innerHTML = `
      <div class="id-engine-container">
        <!-- Main designer area -->
        <div class="id-engine-workspace">
          <div class="id-engine-workspace-header">
            <h3 class="id-engine-workspace-title">ID Card Canvas Designer</h3>
            <div class="id-engine-tabs">
              <button class="id-engine-tab-btn id-engine-active" data-side="front">Front View</button>
              <button class="id-engine-tab-btn" data-side="back">Back View</button>
            </div>
          </div>

          <!-- Aspect ratio credit card wrapper -->
          <div class="id-engine-canvas-wrapper">
            <div class="id-engine-card-flip-container" id="id-engine-card-flipper">
              <!-- FRONT SIDE -->
              <div class="id-engine-card-side id-engine-card-front" id="id-engine-card-front-canvas"></div>
              <!-- BACK SIDE -->
              <div class="id-engine-card-side id-engine-card-back" id="id-engine-card-back-canvas"></div>
            </div>
          </div>

          <div style="font-size: 0.8rem; color: var(--id-engine-text-muted);">
            💡 Click on any element to select, drag to reposition, or drag the handles to resize.
          </div>
        </div>

        <!-- Sidebar options & properties panel -->
        <div class="id-engine-sidebar">
          
          <!-- Template selector -->
          <div class="id-engine-panel">
            <h4 class="id-engine-panel-title">Layout & Templates</h4>
            <div class="id-engine-control-group">
              <div class="id-engine-field-row">
                <label class="id-engine-label">Card Orientation</label>
                <select class="id-engine-select" id="id-engine-orientation-select">
                  <option value="landscape">Landscape (Horizontal)</option>
                  <option value="portrait">Portrait (Vertical)</option>
                </select>
              </div>
              <div class="id-engine-field-row">
                <label class="id-engine-label">Solid Color / Gradient CSS</label>
                <input type="text" class="id-engine-input" id="id-engine-bg-val-input" placeholder="e.g. #ffffff or linear-gradient(...)">
              </div>
              
              <!-- Dynamic Template Gallery Grid -->
              <div class="id-engine-field-row" style="margin-top: 10px;">
                <label class="id-engine-label">Presets Gallery</label>
                <div class="id-engine-gallery-wrapper" id="id-engine-gallery-container">
                  <!-- Loaded dynamically in JS -->
                </div>
              </div>

              <!-- Custom Background Image Uploaders -->
              <div class="id-engine-uploader-group">
                <input type="file" id="id-engine-upload-bg-front" accept="image/*" style="display: none;">
                <input type="file" id="id-engine-upload-bg-back" accept="image/*" style="display: none;">
                <button class="id-engine-btn id-engine-btn-secondary" style="font-size: 0.75rem; padding: 6px 10px;" id="id-engine-upload-btn-front">Upload Front BG</button>
                <button class="id-engine-btn id-engine-btn-secondary" style="font-size: 0.75rem; padding: 6px 10px;" id="id-engine-upload-btn-back">Upload Back BG</button>
              </div>

              <!-- Dummy hidden select to keep legacy variables compatible -->
              <select class="id-engine-select" id="id-engine-template-select" style="display: none;">
                <option value="">-- Plain Colors / Gradients --</option>
                ${this.templates.map(t => `<option value="${t.id}">${t.name} (${t.side})</option>`).join('')}
              </select>
            </div>
          </div>

          <!-- Active elements list toggles -->
          <div class="id-engine-panel">
            <h4 class="id-engine-panel-title">
              <span>Card Elements</span>
            </h4>
            <div class="id-engine-elements-list" id="id-engine-elements-list-container">
              <!-- Filled dynamically -->
            </div>
          </div>
        </div>

        <!-- Sidebar Column 2 (Properties & Actions) -->
        <div class="id-engine-sidebar">

          <!-- Selection properties panel (visible when element selected) -->
          <div class="id-engine-panel" id="id-engine-properties-panel" style="display: none;">
            <h4 class="id-engine-panel-title">Element Properties</h4>
            <div class="id-engine-control-group" id="id-engine-properties-controls">
              <!-- Loaded dynamically based on selected element type -->
            </div>
          </div>

          <!-- Saved Layout Templates Manager panel -->
          <div class="id-engine-panel">
            <h4 class="id-engine-panel-title">Saved Layout Templates</h4>
            <div class="id-engine-control-group" style="display: flex; flex-direction: column; gap: 8px;">
              <label class="id-engine-label">Select Layout Template</label>
              <select class="id-engine-select" id="id-engine-layout-select" style="width: 100%;">
                <option value="tpl_default">Default Factory Design</option>
              </select>
              
              <label class="id-engine-label" style="margin-top: 4px;">Template Name</label>
              <input class="id-engine-input" id="id-engine-layout-name-input" type="text" value="Default Factory Design" style="width: 100%;">

              <label class="id-engine-label" style="margin-top: 4px;">Template Category / Type</label>
              <select class="id-engine-select" id="id-engine-layout-category-select" style="width: 100%;">
                <option value="Student ID">Student ID</option>
                <option value="Teacher ID">Teacher ID</option>
              </select>
              
              <button class="id-engine-btn id-engine-btn-secondary" id="id-engine-layout-new-btn" style="margin-top: 4px; width: 100%;">+ Create New Template</button>
            </div>
          </div>

          <!-- Add Elements panel -->
          <div class="id-engine-panel">
            <h4 class="id-engine-panel-title">Add Elements</h4>
            <div class="id-engine-control-group" style="display: flex; flex-direction: column; gap: 8px;">
              <label class="id-engine-label">Choose Element Type</label>
              <select class="id-engine-select" id="id-engine-add-element-select" style="width: 100%;">
                <option value="" disabled selected>-- Select Element --</option>
                <optgroup label="Standard Badge Fields">
                  <option value="photo">Photo Field (Avatar)</option>
                  <option value="school_logo">School Logo (Image)</option>
                  <option value="school_name">School Name</option>
                  <option value="name">Student Name</option>
                  <option value="id_number">Student ID Number</option>
                  <option value="program">Program Field</option>
                  <option value="role">Role Badge</option>
                  <option value="dob">Date of Birth</option>
                  <option value="valid_years">Valid Years</option>
                  <option value="signature">Dean Signature</option>
                </optgroup>
                <optgroup label="Custom Elements">
                  <option value="custom_text">Custom Text Block</option>
                  <option value="custom_qr">Custom QR Code</option>
                </optgroup>
              </select>
              
              <button class="id-engine-btn" id="id-engine-add-element-btn" style="margin-top: 4px; width: 100%;">+ Add Element to Card</button>
            </div>
          </div>

          <!-- Global designer actions -->
          <div class="id-engine-panel">
            <h4 class="id-engine-panel-title">Actions</h4>
            <div class="id-engine-control-group" style="display: flex; flex-direction: column; gap: 10px;">
              <button class="id-engine-btn" id="id-engine-save-btn">Save Active Template</button>
              <button class="id-engine-btn id-engine-btn-secondary" id="id-engine-print-preview-btn">Launch Print Preview</button>
            </div>
          </div>

        </div>
      </div>
    `;

    // References to DOM
    this.frontCanvas = this.target.querySelector("#id-engine-card-front-canvas");
    this.backCanvas = this.target.querySelector("#id-engine-card-back-canvas");
    this.flipper = this.target.querySelector("#id-engine-card-flipper");
    this.propertiesPanel = this.target.querySelector("#id-engine-properties-panel");
    this.elementsListContainer = this.target.querySelector("#id-engine-elements-list-container");
    this.bgValInput = this.target.querySelector("#id-engine-bg-val-input");
    this.templateSelect = this.target.querySelector("#id-engine-template-select");
    this.orientationSelect = this.target.querySelector("#id-engine-orientation-select");
  }

  // 2. Bind editor event listeners
  bindEvents() {
    // Side tab switches
    const tabBtns = this.target.querySelectorAll(".id-engine-tab-btn");
    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => {
        tabBtns.forEach(b => b.classList.remove("id-engine-active"));
        btn.classList.add("id-engine-active");
        this.switchSide(btn.getAttribute("data-side"));
      });
    });

    // Save & Print preview triggers
    this.target.querySelector("#id-engine-save-btn").addEventListener("click", () => {
      this.onSave(this.layout);

      if (this.saveUrl) {
        const layoutId = this.activeLayoutId && this.activeLayoutId !== 'tpl_default' ? this.activeLayoutId : 'layout_' + Date.now();
        const layoutName = this.target.querySelector("#id-engine-layout-name-input").value.trim() || "Unnamed Template";
        const layoutCategory = this.target.querySelector("#id-engine-layout-category-select").value;
        this.activeLayoutId = layoutId;

        const payload = {
          action: 'save',
          id: layoutId,
          name: layoutName,
          category: layoutCategory,
          schema: this.layout
        };

        console.log("IDCardEngine: Autosaving schema to " + this.saveUrl, payload);
        fetch(this.saveUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(payload)
        })
        .then(response => {
          if (!response.ok) {
            throw new Error("HTTP error " + response.status);
          }
          return response.json();
        })
        .then(data => {
          console.log("IDCardEngine: Schema saved successfully.", data);
          if (data.status === 'success' && data.templates) {
            this.layoutTemplates = data.templates;
            this.updateLayoutTemplatesDropdown();
          }
          const event = new CustomEvent('idcardengine:savesuccess', { detail: data });
          window.dispatchEvent(event);
        })
        .catch(err => {
          console.error("IDCardEngine: Failed to save schema.", err);
          const event = new CustomEvent('idcardengine:saveerror', { detail: err });
          window.dispatchEvent(event);
        });
      }
    });

    // Layout template selector updates
    const layoutSelect = this.target.querySelector("#id-engine-layout-select");
    if (layoutSelect) {
      layoutSelect.addEventListener("change", (e) => {
        const selectedId = e.target.value;
        this.activeLayoutId = selectedId;
        
        const found = this.layoutTemplates.find(t => t.id === selectedId);
        if (found) {
          const nameInput = this.target.querySelector("#id-engine-layout-name-input");
          if (nameInput) nameInput.value = found.name;
          
          const categorySelect = this.target.querySelector("#id-engine-layout-category-select");
          if (categorySelect) categorySelect.value = found.category || 'Student ID';
          
          if (found.schema) {
            this.loadLayout(found.schema);
          } else {
            this.loadLayout(this.loadDefaultLayout());
          }
        }
      });
    }

    // New template button updates
    const layoutNewBtn = this.target.querySelector("#id-engine-layout-new-btn");
    if (layoutNewBtn) {
      layoutNewBtn.addEventListener("click", () => {
        this.activeLayoutId = 'layout_' + Date.now();
        
        const nameInput = this.target.querySelector("#id-engine-layout-name-input");
        if (nameInput) nameInput.value = "New Template Layout";
        
        const defaultFront = this.templates && this.templates.find(t => t.id === 'tpl_blue_front');
        const defaultBack = this.templates && this.templates.find(t => t.id === 'tpl_dark_back');
        
        const blankLayout = {
          orientation: 'portrait',
          elements: [], // Completely blank elements list
          backgrounds: {
            front: {
              type: defaultFront ? 'image' : 'color',
              value: defaultFront ? defaultFront.bgUrl : '#f8fafc',
              templateId: defaultFront ? 'tpl_blue_front' : ''
            },
            back: {
              type: defaultBack ? 'image' : 'color',
              value: defaultBack ? defaultBack.bgUrl : '#ffffff',
              templateId: defaultBack ? 'tpl_dark_back' : ''
            }
          }
        };

        this.loadLayout(blankLayout);
        console.log("IDCardEngine: Ready to build new blank template: " + this.activeLayoutId);
      });
    }

    // Add Element button trigger
    const addElementBtn = this.target.querySelector("#id-engine-add-element-btn");
    if (addElementBtn) {
      addElementBtn.addEventListener("click", () => {
        const select = this.target.querySelector("#id-engine-add-element-select");
        if (select && select.value) {
          this.addElementToCard(select.value);
        }
      });
    }

    this.target.querySelector("#id-engine-print-preview-btn").addEventListener("click", () => {
      if (this.onPrintPreview) {
        this.onPrintPreview(this);
      } else {
        this.renderPrintPreview({
          layoutSchema: this.layout,
          cardHolderData: {
            id: "STU-2026-0041",
            name: "Alexander Mercer",
            role: "Student",
            program: "Information Technology",
            dob: "2005-08-14",
            validYears: "2026 - 2030",
            photoUrl: "" // Will render beautiful SVG outline
          }
        });
      }
    });



    // Background color/gradient updates
    this.bgValInput.addEventListener("input", (e) => {
      const side = this.activeSide;
      this.layout.backgrounds[side].type = 'color';
      this.layout.backgrounds[side].value = e.target.value;
      this.layout.backgrounds[side].templateId = '';
      this.templateSelect.value = '';
      this.applyBackground(side);
    });

    // Template selection dropdown updates (maintained for fallback)
    this.templateSelect.addEventListener("change", (e) => {
      const templateId = e.target.value;
      const side = this.activeSide;
      if (templateId) {
        const template = this.templates.find(t => t.id === templateId);
        if (template) {
          this.layout.backgrounds[side].type = 'image';
          this.layout.backgrounds[side].value = template.bgUrl;
          this.layout.backgrounds[side].templateId = templateId;
          this.bgValInput.value = template.bgUrl;
        }
      } else {
        this.layout.backgrounds[side].type = 'color';
        this.layout.backgrounds[side].value = '#ffffff';
        this.layout.backgrounds[side].templateId = '';
        this.bgValInput.value = '#ffffff';
      }
      this.applyBackground(side);
      this.renderTemplateGallery();
    });

    // Custom Background Uploaders File Picker Listeners
    const uploadBtnFront = this.target.querySelector("#id-engine-upload-btn-front");
    const uploadInputFront = this.target.querySelector("#id-engine-upload-bg-front");
    const uploadBtnBack = this.target.querySelector("#id-engine-upload-btn-back");
    const uploadInputBack = this.target.querySelector("#id-engine-upload-bg-back");

    if (uploadBtnFront && uploadInputFront) {
      uploadBtnFront.addEventListener("click", () => uploadInputFront.click());
      uploadInputFront.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const dataUrl = evt.target.result;
            // Apply custom front background
            this.layout.backgrounds.front.type = 'image';
            this.layout.backgrounds.front.value = dataUrl;
            this.layout.backgrounds.front.templateId = ''; // Clear selected preset checkmarks
            
            // Focus front side
            if (this.activeSide !== 'front') {
              this.switchSide('front');
              const tabBtns = this.target.querySelectorAll(".id-engine-tab-btn");
              tabBtns.forEach(btn => {
                if (btn.getAttribute("data-side") === 'front') btn.classList.add("id-engine-active");
                else btn.classList.remove("id-engine-active");
              });
            }
            
            this.bgValInput.value = dataUrl;
            this.refreshDesignerCanvas();
            if (this.onChange) this.onChange(this);
          };
          reader.readAsDataURL(file);
        }
      });
    }

    if (uploadBtnBack && uploadInputBack) {
      uploadBtnBack.addEventListener("click", () => uploadInputBack.click());
      uploadInputBack.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (file) {
          const reader = new FileReader();
          reader.onload = (evt) => {
            const dataUrl = evt.target.result;
            // Apply custom back background
            this.layout.backgrounds.back.type = 'image';
            this.layout.backgrounds.back.value = dataUrl;
            this.layout.backgrounds.back.templateId = '';
            
            // Focus back side
            if (this.activeSide !== 'back') {
              this.switchSide('back');
              const tabBtns = this.target.querySelectorAll(".id-engine-tab-btn");
              tabBtns.forEach(btn => {
                if (btn.getAttribute("data-side") === 'back') btn.classList.add("id-engine-active");
                else btn.classList.remove("id-engine-active");
              });
            }
            
            this.bgValInput.value = dataUrl;
            this.refreshDesignerCanvas();
            if (this.onChange) this.onChange(this);
          };
          reader.readAsDataURL(file);
        }
      });
    }

    // Layout orientation changes
    this.orientationSelect.addEventListener("change", (e) => {
      this.layout.orientation = e.target.value;
      this.refreshDesignerCanvas();
    });

    // Global drag & resize handlers on document
    document.addEventListener("mousemove", (e) => this.handleMouseMove(e));
    document.addEventListener("mouseup", () => this.handleMouseUp());
  }

  switchSide(side) {
    this.activeSide = side;
    if (side === 'front') {
      this.flipper.classList.remove("id-engine-flipped");
    } else {
      this.flipper.classList.add("id-engine-flipped");
    }
    
    // Clear selection if switching sides and selected item is on the other side
    if (this.selectedElementId) {
      const el = this.layout.elements.find(item => item.id === this.selectedElementId);
      if (el && el.side !== side) {
        this.deselectElement();
      }
    }
    
    this.refreshBackgroundInputs();
    this.refreshElementsList();
    if (this.onChange) this.onChange(this);
  }

  // 3. Render Canvas elements & apply styles
  refreshDesignerCanvas() {
    // Toggle Landscape/Portrait class on wrapper
    const wrapper = this.target.querySelector(".id-engine-canvas-wrapper");
    if (wrapper) {
      if (this.layout.orientation === 'portrait') {
        wrapper.classList.add("id-engine-portrait");
      } else {
        wrapper.classList.remove("id-engine-portrait");
      }
    }

    this.renderSideCanvas('front', this.frontCanvas);
    this.renderSideCanvas('back', this.backCanvas);
    
    this.applyBackground('front');
    this.applyBackground('back');
    
    this.refreshBackgroundInputs();
    this.refreshElementsList();
    this.refreshPropertiesPanel();
    this.renderTemplateGallery();
  }

  applyBackground(side) {
    const bgInfo = this.layout.backgrounds[side];
    const canvas = side === 'front' ? this.frontCanvas : this.backCanvas;
    
    if (bgInfo.type === 'image') {
      canvas.style.backgroundImage = `url(${bgInfo.value})`;
      canvas.style.backgroundColor = '#ffffff';
    } else {
      canvas.style.backgroundImage = 'none';
      // Treat solid color or CSS gradient
      if (bgInfo.value.includes('gradient')) {
        canvas.style.background = bgInfo.value;
      } else {
        canvas.style.backgroundColor = bgInfo.value;
        canvas.style.background = bgInfo.value;
      }
    }
  }

  // Butter-smooth targeted element updating to avoid DOM layout thrashing
  updateElementVisual(el) {
    const canvas = el.side === 'front' ? this.frontCanvas : this.backCanvas;
    const elDiv = canvas.querySelector(`.id-engine-element[data-id="${el.id}"]`);
    if (elDiv) {
      elDiv.style.setProperty('--element-x', el.x);
      elDiv.style.setProperty('--element-y', el.y);
      elDiv.style.setProperty('--element-width', el.width);
      elDiv.style.left = 'calc(var(--element-x) * 1%)';
      elDiv.style.top = 'calc(var(--element-y) * 1%)';
      elDiv.style.width = 'calc(var(--element-width) * 1%)';
      if (el.height) {
        elDiv.style.setProperty('--element-height', el.height);
        elDiv.style.height = 'calc(var(--element-height) * 1%)';
      } else {
        elDiv.style.removeProperty('--element-height');
        elDiv.style.height = '';
      }

      if (el.id.startsWith('qr_code')) {
        const qrWrapper = elDiv.querySelector(".id-engine-qr-code");
        if (qrWrapper) {
          qrWrapper.innerHTML = QRCodeGenerator.toSVGString(this.designerPlaceholderData.id, el.fontColor || '#000000');
        }
      } else if (el.id === 'photo') {
        const placeholder = elDiv.querySelector(".id-engine-photo-placeholder");
        if (placeholder) {
          if (this.designerPlaceholderData.photoUrl) {
            placeholder.innerHTML = `<img class="id-engine-photo-image" src="${this.designerPlaceholderData.photoUrl}">`;
          } else {
            placeholder.innerHTML = `
              <svg style="width: 40%; height: 40%; margin-bottom: 4px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
              </svg>
              Photo
            `;
          }
        }
      } else if (el.id === 'school_logo') {
        const placeholder = elDiv.querySelector(".id-engine-photo-placeholder");
        if (placeholder) {
          if (this.designerPlaceholderData.schoolLogoUrl) {
            placeholder.innerHTML = `<img class="id-engine-photo-image" style="object-fit: contain; background: transparent;" src="${this.designerPlaceholderData.schoolLogoUrl}">`;
          } else {
            placeholder.innerHTML = `
              <svg style="width: 30%; height: 30%; margin-bottom: 2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.33-1.65m-15 0V10.33" />
              </svg>
              Logo
            `;
          }
        }
      } else if (el.id === 'signature') {
        const placeholder = elDiv.querySelector(".id-engine-photo-placeholder");
        if (placeholder) {
          if (this.designerPlaceholderData.signatureUrl) {
            placeholder.innerHTML = `<img class="id-engine-photo-image" style="object-fit: contain; background: transparent;" src="${this.designerPlaceholderData.signatureUrl}">`;
          } else {
            placeholder.innerHTML = `
              <svg style="width: 25%; height: 25%; margin-bottom: 2px;" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
              </svg>
              Signature
            `;
          }
        }
      } else {
        const textNode = elDiv.querySelector(".id-engine-text-node");
        if (textNode) {
          elDiv.style.fontSize = `calc(${el.fontSize || 3.2} * 1cqw)`;
          elDiv.style.color = el.fontColor || '#000000';
          elDiv.style.fontWeight = el.fontWeight || 'normal';
          elDiv.style.fontStyle = el.fontStyle || 'normal';
          elDiv.style.textAlign = el.textAlign || 'left';
          elDiv.style.justifyContent = el.textAlign === 'center' ? 'center' : (el.textAlign === 'right' ? 'flex-end' : 'flex-start');
          
          if (el.isCustom) {
            textNode.innerText = el.text || '';
          } else {
            textNode.innerText = this.designerPlaceholderData[el.id] || el.name;
          }
        }
      }
    }
  }

  refreshBackgroundInputs() {
    const bgInfo = this.layout.backgrounds[this.activeSide];
    this.bgValInput.value = bgInfo.value;
    this.templateSelect.value = bgInfo.templateId || '';
    if (this.orientationSelect) {
      this.orientationSelect.value = this.layout.orientation || 'landscape';
    }
  }

  renderSideCanvas(side, canvasContainer) {
    canvasContainer.innerHTML = '';
    
    // Add Safe Zone Guide guideline overlay
    const safeZoneGuide = document.createElement("div");
    safeZoneGuide.className = "id-engine-safe-zone-guide";
    canvasContainer.appendChild(safeZoneGuide);
    
    // Gather all elements belonging to this side
    const sideElements = this.layout.elements.filter(el => el.side === side);
    
    sideElements.forEach(el => {
      if (!el.visible) return;
      
      const elDiv = document.createElement("div");
      elDiv.className = `id-engine-element ${this.selectedElementId === el.id ? 'id-engine-selected' : ''}`;
      elDiv.setAttribute("data-id", el.id);
      
      // Inline coordinates as CSS Variables
      elDiv.style.setProperty('--element-x', el.x);
      elDiv.style.setProperty('--element-y', el.y);
      elDiv.style.setProperty('--element-width', el.width);
      if (el.height) {
        elDiv.style.setProperty('--element-height', el.height);
      }
      
      // Standard styles applied in CSS via percentage positioning
      elDiv.style.left = 'calc(var(--element-x) * 1%)';
      elDiv.style.top = 'calc(var(--element-y) * 1%)';
      elDiv.style.width = 'calc(var(--element-width) * 1%)';
      if (el.height) {
        elDiv.style.height = 'calc(var(--element-height) * 1%)';
      }

      // Add Resize handles
      const handleNames = ['nw', 'ne', 'se', 'sw'];
      handleNames.forEach(h => {
        const handleDiv = document.createElement("div");
        handleDiv.className = `id-engine-resize-handle id-engine-handle-${h}`;
        handleDiv.setAttribute("data-dir", h);
        elDiv.appendChild(handleDiv);
      });

      // Element contents based on type
      if (el.id === 'photo') {
        const placeholder = document.createElement("div");
        placeholder.className = "id-engine-photo-placeholder";
        if (this.designerPlaceholderData.photoUrl) {
          placeholder.innerHTML = `<img class="id-engine-photo-image" src="${this.designerPlaceholderData.photoUrl}">`;
        } else {
          placeholder.innerHTML = `
            <svg style="width: 40%; height: 40%; margin-bottom: 4px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M15.75 6a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0ZM4.501 20.118a7.5 7.5 0 0 1 14.998 0A17.933 17.933 0 0 1 12 21.75c-2.676 0-5.216-.584-7.499-1.632Z" />
            </svg>
            Photo
          `;
        }
        elDiv.appendChild(placeholder);

      } else if (el.id === 'school_logo') {
        const placeholder = document.createElement("div");
        placeholder.className = "id-engine-photo-placeholder";
        placeholder.style.borderStyle = "dashed";
        if (this.designerPlaceholderData.schoolLogoUrl) {
          placeholder.innerHTML = `<img class="id-engine-photo-image" style="object-fit: contain; background: transparent;" src="${this.designerPlaceholderData.schoolLogoUrl}">`;
        } else {
          placeholder.innerHTML = `
            <svg style="width: 30%; height: 30%; margin-bottom: 2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.33-1.65m-15 0V10.33" />
            </svg>
            Logo
          `;
        }
        elDiv.appendChild(placeholder);

      } else if (el.id === 'signature') {
        const placeholder = document.createElement("div");
        placeholder.className = "id-engine-photo-placeholder";
        placeholder.style.borderStyle = "dashed";
        if (this.designerPlaceholderData.signatureUrl) {
          placeholder.innerHTML = `<img class="id-engine-photo-image" style="object-fit: contain; background: transparent;" src="${this.designerPlaceholderData.signatureUrl}">`;
        } else {
          placeholder.innerHTML = `
            <svg style="width: 25%; height: 25%; margin-bottom: 2px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path stroke-linecap="round" stroke-linejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L6.832 19.82a4.5 4.5 0 0 1-1.897 1.13l-2.685.8.8-2.685a4.5 4.5 0 0 1 1.13-1.897L16.863 4.487Zm0 0L19.5 7.125" />
            </svg>
            Signature
          `;
        }
        elDiv.appendChild(placeholder);

      } else if (el.id.startsWith('qr_code')) {
        const qrWrapper = document.createElement("div");
        qrWrapper.className = "id-engine-qr-code";
        
        // Render embedded QR code based on designer dummy ID
        qrWrapper.innerHTML = QRCodeGenerator.toSVGString(this.designerPlaceholderData.id, el.fontColor || '#000000');
        elDiv.appendChild(qrWrapper);

      } else {
        // Text node
        const textNode = document.createElement("div");
        textNode.className = "id-engine-text-node";
        
        // Font sizing via Container Queries is ideal, but let's calculate relative to canvas width
        // setting style as percentage of container width
        elDiv.style.fontSize = `calc(${el.fontSize || 3.2} * 1cqw)`;
        elDiv.style.color = el.fontColor || '#000000';
        elDiv.style.fontWeight = el.fontWeight || 'normal';
        elDiv.style.fontStyle = el.fontStyle || 'normal';
        elDiv.style.textAlign = el.textAlign || 'left';
        elDiv.style.justifyContent = el.textAlign === 'center' ? 'center' : (el.textAlign === 'right' ? 'flex-end' : 'flex-start');
        
        // Display value
        if (el.isCustom) {
          textNode.innerText = el.text || '';
        } else {
          // Designer preview displays field name/placeholder
          textNode.innerText = this.designerPlaceholderData[el.id] || el.name;
        }
        
        elDiv.appendChild(textNode);
      }

      // Interaction listeners for selection & drag initialization
      elDiv.addEventListener("mousedown", (e) => this.handleElementMouseDown(e, el));
      
      canvasContainer.appendChild(elDiv);
    });
  }

  // 4. Drag & Resize operations
  handleElementMouseDown(e, el) {
    e.stopPropagation();
    
    this.selectElement(el.id);

    const canvas = el.side === 'front' ? this.frontCanvas : this.backCanvas;
    const cardRect = canvas.getBoundingClientRect();
    
    // Check if clicked a resize handle
    if (e.target.classList.contains("id-engine-resize-handle")) {
      this.isResizing = true;
      this.resizeDirection = e.target.getAttribute("data-dir");
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.elementStart = {
        x: el.x,
        y: el.y,
        w: el.width,
        h: el.height || 0
      };
    } else {
      this.isDragging = true;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.elementStart = {
        x: el.x,
        y: el.y,
        w: el.width,
        h: el.height || 0
      };
    }
  }

  handleMouseMove(e) {
    if (!this.isDragging && !this.isResizing) return;
    
    const el = this.layout.elements.find(item => item.id === this.selectedElementId);
    if (!el) return;
    
    const canvas = el.side === 'front' ? this.frontCanvas : this.backCanvas;
    const cardRect = canvas.getBoundingClientRect();
    
    const deltaX = (e.clientX - this.dragStart.x) / cardRect.width * 100;
    const deltaY = (e.clientY - this.dragStart.y) / cardRect.height * 100;

    if (this.isDragging) {
      // Reposition
      let newX = parseFloat((this.elementStart.x + deltaX).toFixed(2));
      let newY = parseFloat((this.elementStart.y + deltaY).toFixed(2));
      
      // Keep boundaries inside card, leaving 2% safety bleed if wanted, but constraint 0 to 100 is nice
      newX = Math.max(0, Math.min(100 - el.width, newX));
      const elHeight = el.height || 5;
      newY = Math.max(0, Math.min(100 - elHeight, newY));
      
      el.x = newX;
      el.y = newY;
      
    } else if (this.isResizing) {
      // Resize
      if (this.resizeDirection.includes('e')) {
        let newW = parseFloat((this.elementStart.w + deltaX).toFixed(2));
        el.width = Math.max(5, Math.min(100 - el.x, newW));
      }
      if (this.resizeDirection.includes('w')) {
        let newW = parseFloat((this.elementStart.w - deltaX).toFixed(2));
        let newX = parseFloat((this.elementStart.x + deltaX).toFixed(2));
        if (newX >= 0 && newW >= 5) {
          el.x = newX;
          el.width = newW;
        }
      }
      if (el.height) {
        if (this.resizeDirection.includes('s')) {
          let newH = parseFloat((this.elementStart.h + deltaY).toFixed(2));
          el.height = Math.max(5, Math.min(100 - el.y, newH));
        }
        if (this.resizeDirection.includes('n')) {
          let newH = parseFloat((this.elementStart.h - deltaY).toFixed(2));
          let newY = parseFloat((this.elementStart.y + deltaY).toFixed(2));
          if (newY >= 0 && newH >= 5) {
            el.y = newY;
            el.height = newH;
          }
        }
      }
    }

    // Refresh only the modified element visually during drag/resize for absolute smoothness
    this.updateElementVisual(el);
  }

  handleMouseUp() {
    if (this.isDragging || this.isResizing) {
      this.isDragging = false;
      this.isResizing = false;
      // Perform full synchronization redraw and trigger change notifications on drag release
      this.refreshDesignerCanvas();
      if (this.onChange) this.onChange(this);
    }
  }

  // 5. Select element & properties logic
  selectElement(elementId) {
    this.selectedElementId = elementId;
    
    // Highlight in editor
    const allElements = this.target.querySelectorAll(".id-engine-element");
    allElements.forEach(div => {
      if (div.getAttribute("data-id") === elementId) {
        div.classList.add("id-engine-selected");
      } else {
        div.classList.remove("id-engine-selected");
      }
    });

    this.refreshElementsList();
    this.refreshPropertiesPanel();
  }

  deselectElement() {
    this.selectedElementId = null;
    const allElements = this.target.querySelectorAll(".id-engine-element");
    allElements.forEach(div => div.classList.remove("id-engine-selected"));
    
    this.refreshElementsList();
    this.refreshPropertiesPanel();
  }

  // Dynamic elements panel switches - Show all elements side-agnostically
  refreshElementsList() {
    this.elementsListContainer.innerHTML = '';
    
    this.layout.elements.forEach(el => {
      const itemDiv = document.createElement("div");
      itemDiv.className = `id-engine-element-list-item ${this.selectedElementId === el.id ? 'id-engine-selected-item' : ''}`;
      
      itemDiv.innerHTML = `
        <div class="id-engine-item-label">
          <span class="id-engine-item-icon ${el.visible ? 'id-engine-active-dot' : ''}"></span>
          <span>${el.name} <small style="color: var(--id-engine-text-muted);">(${el.side.toUpperCase()})</small></span>
        </div>
        <label class="id-engine-toggle" onclick="event.stopPropagation();">
          <input type="checkbox" class="id-engine-visible-chk" ${el.visible ? 'checked' : ''}>
          <span class="id-engine-slider"></span>
        </label>
      `;

      itemDiv.addEventListener("click", () => {
        // Auto-switch card side view if element is on the other side
        if (el.side !== this.activeSide) {
          this.switchSide(el.side);
          // Sync tabs active visual class
          const tabBtns = this.target.querySelectorAll(".id-engine-tab-btn");
          tabBtns.forEach(btn => {
            if (btn.getAttribute("data-side") === el.side) {
              btn.classList.add("id-engine-active");
            } else {
              btn.classList.remove("id-engine-active");
            }
          });
        }
        this.selectElement(el.id);
      });

      itemDiv.querySelector(".id-engine-visible-chk").addEventListener("change", (e) => {
        el.visible = e.target.checked;
        if (!el.visible && this.selectedElementId === el.id) {
          this.deselectElement();
        }
        this.refreshDesignerCanvas();
        if (this.onChange) this.onChange(this);
      });

      this.elementsListContainer.appendChild(itemDiv);
    });
  }

  // Properties form drawer
  refreshPropertiesPanel() {
    if (!this.selectedElementId) {
      this.propertiesPanel.style.display = 'none';
      return;
    }

    const el = this.layout.elements.find(item => item.id === this.selectedElementId);
    if (!el) {
      this.propertiesPanel.style.display = 'none';
      return;
    }

    this.propertiesPanel.style.display = 'block';
    const controlsContainer = this.target.querySelector("#id-engine-properties-controls");
    
    // Properties template
    let controlsHTML = `
      <div class="id-engine-field-row">
        <label class="id-engine-label">Card Side</label>
        <select class="id-engine-select" id="id-prop-side">
          <option value="front">Front Side</option>
          <option value="back">Back Side</option>
        </select>
      </div>
      <div class="id-engine-coords-grid">
        <div class="id-engine-field-row">
          <label class="id-engine-label">X (%)</label>
          <input type="number" step="0.5" class="id-engine-input" id="id-prop-x" value="${el.x}">
        </div>
        <div class="id-engine-field-row">
          <label class="id-engine-label">Y (%)</label>
          <input type="number" step="0.5" class="id-engine-input" id="id-prop-y" value="${el.y}">
        </div>
        <div class="id-engine-field-row">
          <label class="id-engine-label">W (%)</label>
          <input type="number" step="0.5" class="id-engine-input" id="id-prop-w" value="${el.width}">
        </div>
        ${el.height ? `
        <div class="id-engine-field-row">
          <label class="id-engine-label">H (%)</label>
          <input type="number" step="0.5" class="id-engine-input" id="id-prop-h" value="${el.height}">
        </div>` : ''}
      </div>
    `;

    // Visual formatting controls for text type elements
    if (el.id !== 'photo' && el.id !== 'school_logo' && !el.id.startsWith('qr_code') && el.id !== 'signature') {
      controlsHTML += `
        <div class="id-engine-field-row">
          <label class="id-engine-label">Font Size (% of card width)</label>
          <input type="range" min="1.5" max="12" step="0.1" class="id-engine-input" id="id-prop-size" value="${el.fontSize || 3}">
        </div>

        <div class="id-engine-field-row">
          <label class="id-engine-label">Color</label>
          <input type="color" class="id-engine-input" style="height: 38px; padding: 2px;" id="id-prop-color" value="${el.fontColor || '#000000'}">
        </div>

        <div class="id-engine-field-row">
          <label class="id-engine-label">Formatting</label>
          <div class="id-engine-btn-group-3">
            <button class="id-engine-format-btn ${el.fontWeight === 'bold' ? 'id-engine-active' : ''}" id="id-prop-bold"><b>B</b></button>
            <button class="id-engine-format-btn ${el.fontStyle === 'italic' ? 'id-engine-active' : ''}" id="id-prop-italic"><i>I</i></button>
            <button class="id-engine-format-btn" id="id-prop-align-cycle" style="font-size: 0.75rem;">Align: ${el.textAlign.toUpperCase()}</button>
          </div>
        </div>
      `;

      if (el.isCustom) {
        controlsHTML += `
          <div class="id-engine-field-row">
            <label class="id-engine-label">Custom Text</label>
            <textarea class="id-engine-input" rows="2" style="font-family: inherit; resize: vertical;" id="id-prop-text">${el.text || ''}</textarea>
          </div>
        `;
      }
    } else if (el.id.startsWith('qr_code')) {
      controlsHTML += `
        <div class="id-engine-field-row">
          <label class="id-engine-label">QR Code Color</label>
          <input type="color" class="id-engine-input" style="height: 38px; padding: 2px;" id="id-prop-color" value="${el.fontColor || '#000000'}">
        </div>
      `;
    }

    if (el.isCustom) {
      controlsHTML += `
        <button class="id-engine-btn id-engine-btn-danger" style="margin-top: 8px;" id="id-prop-delete-btn">Delete Custom Element</button>
      `;
    }

    controlsContainer.innerHTML = controlsHTML;

    // Bind Properties Inputs
    this.bindPropertyInputs(el);
  }

  bindPropertyInputs(el) {
    const bindVal = (selector, key, isFloat = true) => {
      const input = this.target.querySelector(selector);
      if (input) {
        // Enforce range attributes on inputs dynamically to help browser constraints
        if (isFloat) {
          if (key === 'x') { input.min = 0; input.max = 100 - el.width; }
          if (key === 'y') { input.min = 0; input.max = 100 - (el.height || 5); }
          if (key === 'width') { input.min = 5; input.max = 100 - el.x; }
          if (key === 'height') { input.min = 5; input.max = 100 - el.y; }
        }

        input.addEventListener("input", (e) => {
          let val = isFloat ? parseFloat(e.target.value) : e.target.value;
          if (isFloat && isNaN(val)) return;
          
          if (isFloat) {
            // Strict boundaries checking
            if (key === 'x') val = Math.max(0, Math.min(100 - el.width, val));
            if (key === 'y') val = Math.max(0, Math.min(100 - (el.height || 5), val));
            if (key === 'width') val = Math.max(5, Math.min(100 - el.x, val));
            if (key === 'height') val = Math.max(5, Math.min(100 - el.y, val));
            
            input.value = val;
          }
          
          el[key] = val;
          this.updateElementVisual(el);
        });

        input.addEventListener("change", () => {
          this.refreshDesignerCanvas();
          if (this.onChange) this.onChange(this);
        });
      }
    };

    bindVal("#id-prop-x", "x");
    bindVal("#id-prop-y", "y");
    bindVal("#id-prop-w", "width");
    if (el.height) {
      bindVal("#id-prop-h", "height");
    }

    const sideSelect = this.target.querySelector("#id-prop-side");
    if (sideSelect) {
      sideSelect.value = el.side;
      sideSelect.addEventListener("change", (e) => {
        const newSide = e.target.value;
        el.side = newSide;
        this.switchSide(newSide);
        
        // Sync active class on side tabs
        const tabBtns = this.target.querySelectorAll(".id-engine-tab-btn");
        tabBtns.forEach(btn => {
          if (btn.getAttribute("data-side") === newSide) {
            btn.classList.add("id-engine-active");
          } else {
            btn.classList.remove("id-engine-active");
          }
        });
        
        this.selectElement(el.id);
        if (this.onChange) this.onChange(this);
      });
    }

    if (el.id !== 'photo' && el.id !== 'school_logo' && !el.id.startsWith('qr_code') && el.id !== 'signature') {
      bindVal("#id-prop-size", "fontSize");
      bindVal("#id-prop-color", "fontColor", false);

      const boldBtn = this.target.querySelector("#id-prop-bold");
      boldBtn.addEventListener("click", () => {
        el.fontWeight = el.fontWeight === 'bold' ? 'normal' : 'bold';
        boldBtn.classList.toggle("id-engine-active", el.fontWeight === 'bold');
        this.updateElementVisual(el);
        if (this.onChange) this.onChange(this);
      });

      const italicBtn = this.target.querySelector("#id-prop-italic");
      italicBtn.addEventListener("click", () => {
        el.fontStyle = el.fontStyle === 'italic' ? 'normal' : 'italic';
        italicBtn.classList.toggle("id-engine-active", el.fontStyle === 'italic');
        this.updateElementVisual(el);
        if (this.onChange) this.onChange(this);
      });

      const alignBtn = this.target.querySelector("#id-prop-align-cycle");
      alignBtn.addEventListener("click", () => {
        const alignments = ['left', 'center', 'right'];
        let idx = alignments.indexOf(el.textAlign);
        el.textAlign = alignments[(idx + 1) % alignments.length];
        alignBtn.innerText = `Align: ${el.textAlign.toUpperCase()}`;
        this.updateElementVisual(el);
        if (this.onChange) this.onChange(this);
      });

      if (el.isCustom) {
        const textInput = this.target.querySelector("#id-prop-text");
        textInput.addEventListener("input", (e) => {
          el.text = e.target.value;
          this.updateElementVisual(el);
        });
        textInput.addEventListener("change", () => {
          if (this.onChange) this.onChange(this);
        });
      }
    } else if (el.id.startsWith('qr_code')) {
      bindVal("#id-prop-color", "fontColor", false);
    }

    // Delete custom button
    if (el.isCustom) {
      this.target.querySelector("#id-prop-delete-btn").addEventListener("click", () => {
        this.layout.elements = this.layout.elements.filter(item => item.id !== el.id);
        this.deselectElement();
        this.refreshDesignerCanvas();
        if (this.onChange) this.onChange(this);
      });
    }
  }

  // 6. Custom text blocks builder
  addCustomTextBlock() {
    const side = this.activeSide;
    const newId = `custom_text_${Date.now()}`;
    const newTextElement = {
      id: newId,
      name: `Custom Text (${side})`,
      side: side,
      x: 20.0,
      y: 40.0,
      width: 60.0,
      fontSize: 3.5,
      fontColor: side === 'front' ? '#0f172a' : '#475569',
      fontWeight: 'normal',
      fontStyle: 'normal',
      textAlign: 'center',
      visible: true,
      isCustom: true,
      text: "Custom Text Block"
    };

    this.layout.elements.push(newTextElement);
    this.refreshDesignerCanvas();
    this.selectElement(newId);
    if (this.onChange) this.onChange(this);
  }

  addQRCodeElement() {
    const side = this.activeSide;
    const newId = `qr_code_${Date.now()}`;
    const newQRElement = {
      id: newId,
      name: `QR Code (${side})`,
      side: side,
      x: 35.0,
      y: 40.0,
      width: 25.0,
      fontColor: '#000000',
      visible: true
    };

    this.layout.elements.push(newQRElement);
    this.refreshDesignerCanvas();
    this.selectElement(newId);
    if (this.onChange) this.onChange(this);
  }

  // Dynamic template presets grid with filters and active checkmark overlays
  renderTemplateGallery() {
    const container = this.target.querySelector("#id-engine-gallery-container");
    if (!container) return;
    container.innerHTML = '';

    // Create wrapper for category tabs
    const tabsDiv = document.createElement("div");
    tabsDiv.className = "id-engine-gallery-tabs";

    // Extract dynamic categories from preset templates array
    const categories = ['All Templates', ...new Set(this.templates.map(t => t.category).filter(Boolean))];
    
    categories.forEach(cat => {
      const tabBtn = document.createElement("button");
      tabBtn.className = `id-engine-gallery-tab ${this.activeGalleryCategory === cat ? 'id-engine-active' : ''}`;
      tabBtn.innerText = cat;
      tabBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        this.activeGalleryCategory = cat;
        this.renderTemplateGallery();
      });
      tabsDiv.appendChild(tabBtn);
    });
    container.appendChild(tabsDiv);

    // Create grid for cards
    const gridDiv = document.createElement("div");
    gridDiv.className = "id-engine-gallery-grid";

    // Filter templates based on selected category tab
    const filteredTemplates = this.templates.filter(t => {
      if (this.activeGalleryCategory === 'All Templates') return true;
      return t.category === this.activeGalleryCategory;
    });

    const activeBgInfo = this.layout.backgrounds[this.activeSide];
    const selectedTemplateId = activeBgInfo.templateId;

    filteredTemplates.forEach(t => {
      const card = document.createElement("div");
      card.className = `id-engine-gallery-card ${selectedTemplateId === t.id ? 'id-engine-selected-card' : ''}`;
      card.style.backgroundImage = `url(${t.bgUrl})`;

      const label = document.createElement("div");
      label.className = "id-engine-gallery-card-label";
      label.innerText = `${t.name} (${t.side.toUpperCase()})`;
      card.appendChild(label);

      // Render circular checkmark overlay badge when active
      if (selectedTemplateId === t.id) {
        const check = document.createElement("div");
        check.className = "id-engine-gallery-card-checkmark";
        check.innerHTML = `
          <svg viewBox="0 0 24 24" stroke-width="3.5" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
          </svg>
        `;
        card.appendChild(check);
      }

      card.addEventListener("click", (e) => {
        e.stopPropagation();
        const side = t.side; // Apply to standard side of template preset
        
        this.layout.backgrounds[side].type = 'image';
        this.layout.backgrounds[side].value = t.bgUrl;
        this.layout.backgrounds[side].templateId = t.id;
        
        if (side === this.activeSide) {
          this.bgValInput.value = t.bgUrl;
        }

        // Auto-switch visual side tabs focus if template is on the other side
        if (side !== this.activeSide) {
          this.switchSide(side);
          const tabBtns = this.target.querySelectorAll(".id-engine-tab-btn");
          tabBtns.forEach(btn => {
            if (btn.getAttribute("data-side") === side) {
              btn.classList.add("id-engine-active");
            } else {
              btn.classList.remove("id-engine-active");
            }
          });
        }

        this.refreshDesignerCanvas();
        if (this.onChange) this.onChange(this);
      });

      gridDiv.appendChild(card);
    });

    container.appendChild(gridDiv);
  }

  // 7. PUBLIC METHOD: Render Printable preview modal & launch window print dialog
  renderPrintPreview({ layoutSchema, cardHolderData }) {
    const schema = layoutSchema || this.layout;
    
    // Dynamically inject @page CSS to match the card dimensions exactly
    let printStyleTag = document.getElementById("id-card-print-page-style");
    if (!printStyleTag) {
      printStyleTag = document.createElement("style");
      printStyleTag.id = "id-card-print-page-style";
      document.head.appendChild(printStyleTag);
    }
    const isPortrait = schema.orientation === 'portrait';
    if (isPortrait) {
      printStyleTag.innerHTML = `
        @media print {
          @page {
            size: 53.98mm 85.6mm !important;
            margin: 0 !important;
          }
        }
      `;
    } else {
      printStyleTag.innerHTML = `
        @media print {
          @page {
            size: 85.6mm 53.98mm !important;
            margin: 0 !important;
          }
        }
      `;
    }

    const overlay = document.createElement("div");
    overlay.className = "id-engine-print-preview-overlay";
    
    const orientationClass = isPortrait ? 'id-engine-portrait' : '';
    
    const buildCardSideHTML = (side) => {
      const bgInfo = schema.backgrounds[side];
      let bgCSS = '';
      if (bgInfo.type === 'image') {
        bgCSS = `background-image: url(${bgInfo.value});`;
      } else {
        if (bgInfo.value.includes('gradient')) {
          bgCSS = `background: ${bgInfo.value};`;
        } else {
          bgCSS = `background-color: ${bgInfo.value};`;
        }
      }
      
      const sideEls = schema.elements.filter(el => el.side === side && el.visible);
      let elsHTML = '';
      
      sideEls.forEach(el => {
        const isValEmpty = (key) => !cardHolderData[key] || cardHolderData[key].trim() === '';
        
        // Skip empty elements dynamically
        if (el.id === 'dob' && isValEmpty('dob')) return;
        if (el.id === 'program' && isValEmpty('program')) return;
        if (el.id === 'role' && isValEmpty('role')) return;
        if (el.id === 'id_number' && isValEmpty('id')) return;
        if (el.id === 'name' && isValEmpty('name')) return;
        if (el.id === 'valid_years' && isValEmpty('validYears')) return;
        if (el.id === 'school_name' && isValEmpty('schoolName')) return;
        
        let inner = '';
        if (el.id === 'photo') {
          const photoUrl = cardHolderData.photoUrl || createDefaultAvatarBase64();
          inner = `<img class="id-engine-print-card-photo" src="${photoUrl}">`;
        } else if (el.id === 'school_logo') {
          const logoUrl = cardHolderData.schoolLogoUrl || createDefaultSchoolLogo();
          inner = `<img class="id-engine-print-card-photo" style="object-fit: contain; background: transparent;" src="${logoUrl}">`;
        } else if (el.id === 'signature') {
          // Fallback to stylized SVG signature of Dean if empty
          const sigUrl = cardHolderData.signatureUrl || `data:image/svg+xml;base64,${btoa(`
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 150 50" width="150" height="50">
              <path d="M 10 35 C 30 10, 45 45, 60 15 C 75 5, 80 40, 95 30 C 110 20, 120 40, 140 25" fill="none" stroke="#1e3a8a" stroke-width="2" stroke-linecap="round"/>
              <text x="10" y="47" font-family="Georgia, serif" font-size="6" fill="#64748b" letter-spacing="1">DEAN OF STUDENTS</text>
            </svg>
          `.trim())}`;
          inner = `<img class="id-engine-print-card-photo" style="object-fit: contain; background: transparent;" src="${sigUrl}">`;
        } else if (el.id.startsWith('qr_code')) {
          const qrSVG = QRCodeGenerator.toSVGString(cardHolderData.id || "STU-EMPTY", el.fontColor || '#000000');
          inner = `<div class="id-engine-print-card-qr">${qrSVG}</div>`;
        } else {
          let textVal = '';
          if (el.isCustom) {
            textVal = el.text || '';
          } else {
            if (el.id === 'name') textVal = cardHolderData.name;
            if (el.id === 'school_name') textVal = cardHolderData.schoolName;
            if (el.id === 'id_number') textVal = cardHolderData.id;
            if (el.id === 'role') textVal = cardHolderData.role;
            if (el.id === 'program') textVal = cardHolderData.program;
            if (el.id === 'dob') textVal = `DOB: ${cardHolderData.dob}`;
            if (el.id === 'valid_years') textVal = cardHolderData.validYears || cardHolderData.valid_years || '';
          }
          inner = `<div class="id-engine-text-node">${textVal}</div>`;
        }
        
        elsHTML += `
          <div class="id-engine-print-card-element ${el.height ? 'id-engine-has-height' : ''}" style="
            --element-x: ${el.x}; 
            --element-y: ${el.y}; 
            --element-width: ${el.width}; 
            ${el.height ? `--element-height: ${el.height};` : ''}
            --font-size-pct: ${el.fontSize || 3};
            color: ${el.fontColor || '#000000'};
            font-weight: ${el.fontWeight || 'normal'};
            font-style: ${el.fontStyle || 'normal'};
            text-align: ${el.textAlign || 'left'};
            justify-content: ${el.textAlign === 'center' ? 'center' : (el.textAlign === 'right' ? 'flex-end' : 'flex-start')};
          ">
            ${inner}
          </div>
        `;
      });
      
      return `
        <div class="id-engine-print-card id-engine-print-card-${side} ${orientationClass}" style="${bgCSS}">
          ${elsHTML}
        </div>
      `;
    };
    
    const frontHTML = buildCardSideHTML('front');
    const backHTML = buildCardSideHTML('back');
    
    overlay.innerHTML = `
      <div class="id-engine-print-preview-modal">
        <div class="id-engine-print-preview-header">
          <h3 class="id-engine-print-preview-title">ID Card Print Layout</h3>
          <button class="id-engine-btn id-engine-btn-secondary" style="padding: 4px 10px;" id="id-engine-close-preview-btn">✕ Close</button>
        </div>
        <div class="id-engine-print-preview-body">
          <p style="margin: 0; text-align: center; color: var(--id-engine-text-muted); font-size: 0.875rem;">
            Ensure background graphics and colors are enabled in your browser print settings.
          </p>
          <div class="id-engine-print-preview-cards">
            ${frontHTML}
            ${backHTML}
          </div>
        </div>
        <div class="id-engine-print-preview-actions" style="display: flex; gap: 12px; justify-content: center;">
          <button class="id-engine-btn" id="id-engine-print-front-btn">Print Front Only</button>
          <button class="id-engine-btn" id="id-engine-print-back-btn">Print Back Only</button>
          <button class="id-engine-btn id-engine-btn-secondary" id="id-engine-print-both-btn">Print Both Sides</button>
        </div>
      </div>
    `;
    
    document.body.appendChild(overlay);
    
    overlay.querySelector("#id-engine-close-preview-btn").addEventListener("click", () => {
      document.body.removeChild(overlay);
    });
    
    overlay.querySelector("#id-engine-print-front-btn").addEventListener("click", () => {
      overlay.setAttribute("data-print-mode", "front");
      window.print();
    });

    overlay.querySelector("#id-engine-print-back-btn").addEventListener("click", () => {
      overlay.setAttribute("data-print-mode", "back");
      window.print();
    });

    overlay.querySelector("#id-engine-print-both-btn").addEventListener("click", () => {
      overlay.setAttribute("data-print-mode", "both");
      window.print();
    });
  }
}
