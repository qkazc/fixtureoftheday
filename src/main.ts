// UI entry point: picks the day and renders it. The day is, in order:
// a #YYYY-MM-DD fragment, a ?date=YYYY-MM-DD parameter, or today's date.
import './style.css';
import { generateMarket } from '../engine';
import { isoDate } from './format';
import { renderGame } from './view';

const app = document.querySelector<HTMLDivElement>('#app')!;

function chosenDate(): string {
  const fromHash = location.hash.slice(1);
  if (fromHash) return fromHash;
  return new URLSearchParams(location.search).get('date') ?? isoDate(new Date());
}

function start(): void {
  const date = chosenDate();
  try {
    renderGame(app, generateMarket(date));
  } catch (err) {
    app.textContent = `Could not load the market for "${date}": ${(err as Error).message}`;
  }
}

window.addEventListener('hashchange', start);
start();
