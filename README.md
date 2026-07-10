# Premium ID Card Design & Printing Engine

A lightweight, high-performance, client-side JavaScript and CSS layout editor and print compiler. The engine enables physical-card-size canvas design editing and printing for academic and corporate ID badges matching strict **ISO/IEC 7810 ID-1 (CR80) plastic PVC card standards**.

---

## Key Features

* **Strict CR80 Sizing & Aspect Ratios**:
  * Canvas maintains a precise aspect ratio of `1.585:1` (Portrait: `0.6309:1`).
  * Printed cards compile to exact physical dimensions (`85.6mm` x `53.98mm`) with a `3.18mm` rounded corner radius and `1.6mm` bleed-safe internal margins.
* **WYSIWYG Layout Consistency**:
  * **Unified Text Alignment and Flex Layout**: Moved inline formatting rules (like `fontSize`, `color`, `fontWeight`, `fontStyle`, `textAlign`, and `justifyContent`) from the inner `.id-engine-text-node` to the parent `.id-engine-element` container. This ensures text layouts align identically between the interactive editor canvas, the print preview modal, and the physical print.
  * **Element Height Truncation Fix**: Automatically clears inline heights for auto-height elements, preventing vertical text clipping bugs and ensuring proper multi-line wrapping.
* **Auto-Matching Paper size**:
  * Dynamically injects unnamed `@page` stylesheet rules at print-time, forcing the browser's native print preview dialog's default sheet size to match standard card boundaries with `0mm` margins.
* **Double-Sided Printing & Page Break Separation**:
  * Splits the front and back card templates onto separate pages (**Page 1** and **Page 2**) during dual-sided prints.
  * **Blank Page Suppression**: Automatically overrides page breaks if printing a single side, ensuring zero blank pages are generated.
* **Separate Card Side Printing**:
  * Action controls to print **Front Only**, **Back Only**, or **Both Sides** simultaneously, with live on-screen modal preview updates.
* **100% Compliant QR Code Generator**:
  * High-performance built-in QR generator fully aligned with the official QR Level M mask specification.
  * Corrected grid module traversal reservation and top-right format bits drawing order.
  * Achieves **0 mismatches** (pixel-for-pixel compatibility) against the standard npm `qrcode` library, ensuring instant recognition by mobile phone camera scanners even at very small physical print sizes.
* **Branded Academic Headers**:
  * Built-in support for school branding elements: School Name (editable text) and School Logo (vector SVG/crest fallback) positioned in the header.
* **Dynamic Template Gallery**:
  * Fully responsive tabbed presets grid that categorizes and displays templates dynamically from initialization data, rendering scale-in checkmark badges.
* **Layout Template Categorization**:
  * Custom layout schemas can be saved specifically as either a **Student ID** or **Teacher ID** template using the category dropdown.
  * Dropdown selections show layout categories next to their names (e.g. `Template Name (Student ID)`), and selection changes dynamically restore saved categories in the UI.
* **Geometric Vector Layout Generator**:
  * Real-time rendering of modern geometric backgrounds featuring diagonal polygons, soft shadows, concentric curve textures, and shiny brushed metallic separators (Gold, Silver, Titanium, Rose Gold).
* **Drag-and-Drop Canvas Properties Editor**:
  * Reposition, resize, customize, or hide coordinates, colors, font properties, and text alignment on the fly.
* **Blank Canvas & Unified Element Library**:
  * Creating new templates clears all optional components, rendering a completely empty designer layout.
  * Standard and custom card elements (Photo, Logo, School Name, Details, Custom Text/QR blocks) can be dynamically added to either card side on demand using the categorized sidebar Elements Library dropdown menu.

---

## File Structure

```bash
├── index.html           # Simulation Dashboard / Host integration example
├── id-card-engine.js    # Core designer logic, canvas rendering, and print overlays
├── id-card-engine.css   # Main layout columns, component styling, and media print query rules
├── save-template.php    # Backend PHP API saving layouts to local JSON data store
└── saved-templates.json # Database file containing layout template presets and custom configurations
```

---

## Initialization & Custom Layouts

You can initialize the card editor passing either a templates array or a detailed configuration object.

### A. Minimal Initialization (Boilerplate Defaults)
Mounts automatically to `#id-designer-container`:
```javascript
const designer = new IDCardEngine(templatesArray);
```

### B. Advanced Initialization (Load Saved Layouts & Hook REST Save URLs)
If loading a previously stored card template, pass the layout JSON object using the `layout` property. Setting `saveUrl` automatically POSTs coordinates payload to that API endpoint when "Save Schema" is clicked:
```javascript
const designer = new IDCardEngine({
  target: '#id-designer-container',
  templates: templatesArray,
  layout: savedLayoutSchema,      // JSON layout object retrieved from database
  saveUrl: 'save-template.php'   // REST API save endpoint
});
```

### C. Loading Layouts at Runtime
To switch templates or load revisions dynamically without reloading the page, call the public instance method:
```javascript
designer.loadLayout(newLayoutSchema);
```

---

## Communication: Custom Window Events

The plugin communicates with the host application by publishing global standard Custom Events on the `window` object:

### 1. Selection & Drag Change Event (`idcardengine:change`)
Dispatched whenever coordinates are modified, templates are loaded, or canvas selection changes. Use this to update input forms in your host panel.
```javascript
window.addEventListener('idcardengine:change', (e) => {
  const engine = e.detail;
  updateHostInputFields(engine.layout.elements);
});
```

### 2. Save Trigger Event (`idcardengine:save`)
Dispatched when the user clicks the "Save Layout" button in the editor toolbar. Returns the layout configuration JSON object.
```javascript
window.addEventListener('idcardengine:save', (e) => {
  const layoutSchema = e.detail;
  saveLayoutSchema(layoutSchema);
});
```

### 3. Save REST Response Events (`idcardengine:savesuccess` / `idcardengine:saveerror`)
If `saveUrl` is configured, the engine fires these events returning the server API response JSON or the error object.
```javascript
window.addEventListener('idcardengine:savesuccess', (e) => {
  console.log("Template saved successfully:", e.detail.message);
});

window.addEventListener('idcardengine:saveerror', (e) => {
  console.error("Autosave failed:", e.detail);
});
```

---

## Synchronizing Host Data to the Canvas

To update values on the editor canvas live (e.g. when typing student details, taking a photo with the webcam, or loading database columns), update the engine's placeholder object and call refresh:

```javascript
function syncPlaceholderData() {
  designer.designerPlaceholderData = {
    id: "STU-2026-0041",
    name: "Alexander Mercer",
    role: "Student",
    program: "Information Technology",
    dob: "2005-08-14",
    validYears: "2026 - 2030",
    photoUrl: capturedWebcamBase64,  // Webcam stream frame
    schoolLogoUrl: schoolLogoBase64, // Base64 uploaded logo
    schoolName: "Acme Academy"
  };

  // Re-draw the canvas elements with the new data
  designer.refreshDesignerCanvas();
}
```

---

## Customizing Default Fallbacks

If a database value is empty, the print preview compiler automatically handles layout rendering by injecting default vector graphics base64 strings:
* **Photo Avatar silhouette**: Renders `createDefaultAvatarBase64()`
* **School Logo template**: Renders `createDefaultSchoolLogo()`
* **Signature outline**: Renders a stylized vector signature path

No additional file uploads or static asset hosting are required to initialize or run the plugin.
