// Historische Nationalflaggen (Stand 1939, vereinfacht) als SVG-URLs.
const files = import.meta.glob('../assets/flags/*.svg', { eager: true, query: '?url', import: 'default' });
const FLAGS = {};
for (const [path, url] of Object.entries(files)) {
  FLAGS[path.split('/').pop().replace('.svg', '')] = url;
}
export function flagUrl(code) {
  return FLAGS[code] || '';
}
