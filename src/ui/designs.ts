// Popup designs. Look is pure CSS in designs.css, keyed by <html data-design>. swatch = [background, accent] for pickers.
export const DESIGNS = [
  { id: 'aurora', name: 'Aurora Glass', swatch: ['#0a0e1c', '#5b8dff'] },
  { id: 'studio', name: 'Studio Hardware', swatch: ['#d4d5d8', '#ff5a1f'] },
  { id: 'rams', name: 'Rams Dial', swatch: ['#e9e8e3', '#f26a1b'] },
  { id: 'noir', name: 'Noir Gold', swatch: ['#0b0b0c', '#c9a45a'] },
  { id: 'phosphor', name: 'Phosphor Terminal', swatch: ['#050a06', '#5dff8a'] },
  { id: 'vinyl', name: 'Vinyl', swatch: ['#17110d', '#e0a64a'] },
  { id: 'synthwave', name: 'Synthwave', swatch: ['#1b0b3d', '#3df2ff'] },
  { id: 'liquid', name: 'Liquid Orb', swatch: ['#06232b', '#2de2c8'] },
  { id: 'soft', name: 'Soft Clay', swatch: ['#e8e4f3', '#6b4fe0'] },
  { id: 'swiss', name: 'Swiss Editorial', swatch: ['#f5f3ee', '#e5261f'] },
  { id: 'spectrum', name: 'Spectrum Wall', swatch: ['#120d14', '#ff6b81'] },
  { id: 'pill', name: 'Pill Slider', swatch: ['#f4f6fb', '#2f55e6'] },
] as const;

export type Design = (typeof DESIGNS)[number]['id'];
export const DEFAULT_DESIGN: Design = 'aurora';
export const isDesign = (v: unknown): v is Design => DESIGNS.some((d) => d.id === v);
