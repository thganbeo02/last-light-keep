import { TextureLoader } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader().register(parser => ({
  name: 'HeroTextures',
  // Artifact previews permit inline images but block fetches from data and blob URLs.
  async beforeRoot() {
    parser.textureLoader = new TextureLoader(parser.options.manager);
    await Promise.all((parser.json.images ?? []).map(async image => {
      if (image.bufferView === undefined) return;
      const buffer = await parser.getDependency('bufferView', image.bufferView);
      image.uri = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(new Blob([buffer], { type: image.mimeType }));
      });
      delete image.bufferView;
    }));
  },
}));

export function loadHeroModel(url) {
  if (!url.startsWith('data:')) return loader.loadAsync(url);
  const bytes = Uint8Array.from(atob(url.slice(url.indexOf(',') + 1)), byte => byte.charCodeAt(0));
  return loader.parseAsync(bytes.buffer, '');
}
