import './style.css';
import { mountHeroWorkshop } from './viewer.js';

const params = new URLSearchParams(location.search);
const workshop = mountHeroWorkshop(document);
workshop.show(params.get('hero'), params.get('version'));
