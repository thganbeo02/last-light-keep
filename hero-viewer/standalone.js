import './style.css';
import { mountHeroWorkshop } from './viewer.js';
import voxelAsset from './assets/aldric-voxel.glb?url';

const params = new URLSearchParams(location.search);
const workshop = mountHeroWorkshop(document, { aldricPrototype: params.has('voxel') ? voxelAsset : undefined });
workshop.show(params.get('hero'), params.get('motion'));
