// UI entry point: picks the day (today, or ?date=YYYY-MM-DD) and renders it.
import './style.css';
import { generateMarket } from '../engine';
import { isoDate } from './format';
import { renderGame } from './view';

const app = document.querySelector<HTMLDivElement>('#app')!;
const date = new URLSearchParams(location.search).get('date') ?? isoDate(new Date());

try {
  renderGame(app, generateMarket(date));
} catch (err) {
  app.textContent = `Could not load the market for "${date}": ${(err as Error).message}`;
}
