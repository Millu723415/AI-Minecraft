import './ui/style.css';
import { App } from './app';

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ui = document.getElementById('ui') as HTMLElement;
const app = new App(canvas, ui);
(window as unknown as { app: App }).app = app;
void app.start();
